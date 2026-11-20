#!/usr/bin/env node
// node render.mjs still <out.jpg> [--t 3] [--w 1920 --h 1080] [--thumb]
// node render.mjs loop  <out.mp4> [--fps 30] [--loop 24]   (--page closeup for the macro glass version)
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const three = path.join(process.env.ZDF_CACHE || path.join(os.homedir(), '.cache', 'zack-d-films'), 'node_modules', 'three');
const [cmd, out, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
const roots = { scene: here, three };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const srv = http.createServer((req, res) => { const u = decodeURIComponent(new URL(req.url, 'http://x').pathname); const [, r, ...p] = u.split('/'); const b = roots[r]; const f = b && path.join(b, ...p);
  if (!f || !f.startsWith(b) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const W = +opt('w', 1920), H = +opt('h', 1080), LOOP = +opt('loop', 24), FPS = +opt('fps', 30);
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${srv.address().port}/scene/${opt('page', 'index')}.html?w=${W}&h=${H}&loop=${LOOP}${rest.includes('--thumb') ? '&thumb=1' : ''}`);
try { await page.waitForFunction(() => window.ready, null, { timeout: 120000 }); } catch (e) { console.error(errs.join('\n')); process.exit(1); }
const frame = async (t) => { const u = await page.evaluate((x) => window.renderAt(x), t); return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'); };
if (cmd === 'still') { fs.writeFileSync(out, await frame(+opt('t', 3))); console.log('still ->', out); }
else if (cmd === 'loop') {
  const n = Math.round(LOOP * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-tune', 'grain', '-pix_fmt', 'yuv420p', '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error('ffmpeg ' + c)) : r())));
  const t0 = Date.now();
  for (let i = 0; i < n; i++) { const b = await frame(i / FPS); if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once('drain', r)); if (i % 60 === 0) console.log(`frame ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
  ff.stdin.end(); await done; console.log('loop ->', out);
}
if (errs.length) console.error('browser errors:\n' + errs.slice(0, 10).join('\n'));
await browser.close(); srv.close();
