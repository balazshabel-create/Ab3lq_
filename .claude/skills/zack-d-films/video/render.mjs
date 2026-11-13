#!/usr/bin/env node
// Usage:
//   node render.mjs extract <projectDir>             -> build/narration.json from scenes.mjs
//   node render.mjs frames  <projectDir> [--fps 30] [--w 720 --h 1280]   -> build/video.mp4 (silent)
//   node render.mjs stills  <projectDir> [--at 0.5]  -> build/stills/scene-NN.jpg + build/contact.jpg
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = process.env.ZDF_CACHE || path.join(os.homedir(), '.cache', 'zack-d-films');
const [cmd, projArg, ...rest] = process.argv.slice(2);
if (!cmd || !projArg) { console.error('usage: render.mjs extract|frames|stills <projectDir> [opts]'); process.exit(2); }
const proj = path.resolve(projArg);
const build = path.join(proj, 'build');
fs.mkdirSync(build, { recursive: true });
const opt = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };

if (cmd === 'extract') {
  const spec = (await import(pathToFileURL(path.join(proj, 'scenes.mjs')).href + '?' + Date.now())).default;
  const out = {
    voice: spec.voice || 'am_michael', speed: spec.speed || 1.05, drone: spec.drone ?? 0.06,
    scenes: spec.scenes.map((s) => ({ vo: s.vo || '', sfx: s.sfx || [], hold: s.hold ?? 0.3, minDuration: s.minDuration || 0, duration: s.duration || 0, silence: !!s.silence })),
  };
  fs.writeFileSync(path.join(build, 'narration.json'), JSON.stringify(out, null, 2));
  console.log(`extracted ${out.scenes.length} scenes`);
  process.exit(0);
}

// ---- static server: /engine -> here, /three -> three package, /project -> project dir ----
const threeDir = path.join(cache, 'node_modules', 'three');
const roots = { engine: here, three: threeDir, project: proj };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const [, root, ...p] = u.split('/');
  const base = roots[root];
  const file = base && path.join(base, ...p);
  if (!file || !file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found ' + u); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const W = +opt('w', 720), H = +opt('h', 1280);
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/engine/engine.html?w=${W}&h=${H}`);
await page.waitForFunction(() => window.engine, null, { timeout: 60000 });
const info = await page.evaluate(() => window.engine);
if (!info.ready) { console.error('engine failed to start:\n' + info.error + '\n' + logs.join('\n')); await browser.close(); server.close(); process.exit(1); }

const frame = async (t) => {
  const url = await page.evaluate((x) => window.renderAt(x), t);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};
const timings = JSON.parse(fs.readFileSync(path.join(build, 'timings.json'), 'utf8'));

try {
  if (cmd === 'stills') {
    const at = +opt('at', 0.5), dir = path.join(build, 'stills');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    for (const [i, s] of timings.scenes.entries()) {
      // render a few frames leading up to the sample point so stateful scenes settle
      for (const f of [0, 0.5, 0.9]) await frame(s.start + s.duration * at * f);
      fs.writeFileSync(path.join(dir, `scene-${String(i + 1).padStart(2, '0')}.jpg`), await frame(s.start + s.duration * at));
    }
    const n = timings.scenes.length, cols = Math.min(n, 6), rows = Math.ceil(n / cols);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'scene-%02d.jpg'), '-vf', `scale=240:-1,tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', path.join(build, 'contact.jpg')], { stdio: 'inherit' });
    console.log(`stills -> ${dir}  contact sheet -> ${path.join(build, 'contact.jpg')}`);
  } else if (cmd === 'frames') {
    const fps = +opt('fps', 30), total = timings.total, n = Math.ceil(total * fps);
    const outFile = path.join(build, 'video.mp4');
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exit ' + c)))));
    const t0 = Date.now();
    for (let f = 0; f < n; f++) {
      const buf = await frame(f / fps);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % (fps * 5) === 0) { const el = (Date.now() - t0) / 1000; process.stderr.write(`frame ${f}/${n}  ${el.toFixed(0)}s elapsed, ~${f ? ((n - f) * el / f).toFixed(0) : '?'}s left\n`); }
    }
    ff.stdin.end(); await done;
    console.log(`video -> ${outFile} (${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } else throw new Error('unknown command ' + cmd);
  if (logs.length) console.error('browser messages:\n' + [...new Set(logs)].slice(0, 20).join('\n'));
} finally {
  await browser.close(); server.close();
}
