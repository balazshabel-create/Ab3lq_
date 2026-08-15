/**
 * tools/bundle-single-file.mjs — fold the built client into one HTML file.
 *
 * Vite emits index.html plus separate JS and CSS assets. Some hosts (and the
 * Claude Artifact renderer in particular) serve a single page with a strict
 * content-security policy that forbids fetching anything from another host or
 * path, so the game has to arrive as one self-contained document.
 *
 * Two output shapes:
 *   --full      a complete standalone .html file, openable with file://
 *   (default)   body-content only: <style>, the markup, and <script>. This is
 *               what the Artifact renderer wants, because it supplies its own
 *               doctype/head/body wrapper.
 *
 * Usage: node tools/bundle-single-file.mjs [outPath] [--full]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const outPath = process.argv[2] ?? 'dist/jungle-jukebox.html';
const full = process.argv.includes('--full');

const distDir = 'dist';
const assetsDir = join(distDir, 'assets');

const assets = readdirSync(assetsDir).filter((f) => statSync(join(assetsDir, f)).isFile());
const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));

if (!jsFile) throw new Error('no built JS found in dist/assets — run "npm run build" first');

const js = readFileSync(join(assetsDir, jsFile), 'utf8');
const css = cssFile ? readFileSync(join(assetsDir, cssFile), 'utf8') : '';

/**
 * Inlining JS inside a <script> tag ends the tag at the first literal
 * "</script" in the source, even inside a string. Escaping the slash keeps the
 * JavaScript semantically identical while making it safe to embed.
 */
const safeJs = js.replace(/<\/script/gi, '<\\/script');

// The markup the game needs: a canvas for WebGL and a mount point for the UI.
const body = `
<canvas id="game-canvas"></canvas>
<div id="ui-root"></div>
<noscript>
  <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
              background:#0a1410;color:#f3ede1;font-family:sans-serif;text-align:center;padding:24px;">
    JukeJungle needs JavaScript and WebGL to run.
  </div>
</noscript>
`.trim();

// A few rules the host page might otherwise impose. The game assumes it owns
// the whole viewport and that nothing scrolls.
const hostReset = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #050a08;
}
#game-canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
`.trim();

const content = `<style>
${hostReset}
${css}
</style>

${body}

<script type="module">
${safeJs}
</script>
`;

const output = full
  ? `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>JukeJungle</title>
</head>
<body>
${content}</body>
</html>
`
  : content;

writeFileSync(outPath, output, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`wrote ${outPath}`);
console.log(`  css   ${kb(css.length)}`);
console.log(`  js    ${kb(js.length)}`);
console.log(`  total ${kb(output.length)}`);
