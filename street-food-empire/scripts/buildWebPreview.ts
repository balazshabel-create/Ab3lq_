/**
 * ÖNÁLLÓ WEB-ELŐNÉZET ÉPÍTŐ
 *
 * Az `expo export --platform web` egy `dist/` mappát ad: index.html + külön
 * JS bundle. Ez a szkript ebből egyetlen, teljesen önálló HTML fájlt gyárt,
 * amiben a bundle be van ágyazva — így megosztható olyan helyen is, ahol
 * nincs statikus fájlkiszolgáló, és nem lehet külső hosztra hivatkozni.
 *
 * Futtatás:
 *   npx expo export --platform web
 *   npx tsx scripts/buildWebPreview.ts
 *
 * Kimenet:
 *   dist/preview.html            teljes dokumentum (helyi megnyitáshoz, teszthez)
 *   dist/preview.body.html       csak a törzs (beágyazáshoz)
 *
 * FONTOS: a web NEM kiadási cél. A játék mobilra készül; ez előnézet, hogy
 * natív build nélkül is meg lehessen nézni a játékmenetet.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
const bundleDir = join(distDir, '_expo', 'static', 'js', 'web');

// --- A bundle megkeresése (a fájlnévben tartalom-hash van) ---
const bundleFile = readdirSync(bundleDir).find((name) => name.endsWith('.js'));
if (!bundleFile) {
  throw new Error(
    `Nem találom a bundle-t itt: ${bundleDir}\nFuttasd előbb: npx expo export --platform web`,
  );
}

const bundle = readFileSync(join(bundleDir, bundleFile), 'utf8');

/**
 * A bundle-ben előfordulhat `</script>` karaktersorozat (pl. egy sztringben),
 * ami idő előtt lezárná a script elemet. A `<\/script` forma JS-ben azonos
 * jelentésű, a HTML parser viszont már nem ismeri fel lezárásnak.
 */
const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');

/**
 * A KERET
 *
 * A játék sötét, meleg fényű éjszakai piac világa. A keret ezt folytatja:
 * a lap alapja hidegebb és mélyebb, mint a játék háttere (#0A0810 vs #12101A),
 * hogy a "kijelző" melegen világítson ki belőle. Szándékosan egyetlen
 * vizuális világ — világos témát nem is kínálunk, mert a játék maga sötét, és
 * egy világos keret elvágná tőle.
 *
 * Mobilon teljes képernyő; asztali gépen telefon-arányú kerettel középen,
 * mert a felület portré elrendezésre készült.
 */
const styles = `
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
  }

  body {
    overflow: hidden;
    /* Explicit alap: e nélkül a beágyazó felület saját háttere ütne át. */
    background: #0A0810;
    color: #E7E3F5;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  #sfe-stage {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    background:
      radial-gradient(120% 80% at 50% 0%, #17121F 0%, #0A0810 60%),
      #0A0810;
  }

  #root {
    display: flex;
    flex: 1;
    width: 100%;
    height: 100%;
    background: #12101A;
  }

  #sfe-caption {
    display: none;
  }

  /* --- Asztali nézet: telefon-arányú keret --- */
  @media (min-width: 900px) and (min-height: 820px) {
    #sfe-frame {
      width: 390px;
      height: 844px;
      border-radius: 34px;
      overflow: hidden;
      display: flex;
      border: 1px solid #2E2740;
      /* Meleg peremfény: a kijelző mintha kivilágítaná a környezetét. */
      box-shadow:
        0 0 0 8px #14111C,
        0 0 60px -12px rgba(242, 153, 74, 0.35),
        0 40px 80px -20px rgba(0, 0, 0, 0.8);
    }

    #root {
      flex: 1;
      width: 390px;
      height: 844px;
    }

    #sfe-caption {
      display: block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #6E6889;
      text-align: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

const body = `<style id="sfe-shell">${styles}</style>

<div id="sfe-stage">
  <div id="sfe-frame"><div id="root"></div></div>
  <p id="sfe-caption">Street Food Empire · böngészős előnézet</p>
</div>

<noscript>A játék futtatásához engedélyezned kell a JavaScriptet.</noscript>

<script id="sfe-bundle">${safeBundle}</script>`;

const fullDocument = `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
<title>Street Food Empire</title>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(join(distDir, 'preview.html'), fullDocument);
writeFileSync(join(distDir, 'preview.body.html'), body);

const kb = (text: string) => `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;
console.log(`✓ dist/preview.html        ${kb(fullDocument)}  (teljes dokumentum)`);
console.log(`✓ dist/preview.body.html   ${kb(body)}  (csak törzs)`);
console.log(`  beágyazott bundle: ${bundleFile}`);
