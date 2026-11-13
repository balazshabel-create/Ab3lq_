// The Shelter — Part 1. Interactive story for the zack-d-films video engine.

const NIGHT = { top: '#060c26', bottom: '#1c2852', sunColor: '#9fb1ff', sunIntensity: 1.3, ambient: 0.8, fogNear: 25, fogFar: 160 };

// ---------- small helpers ----------
function screen(THREE, w, h, px = 512) {
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round((px * h) / w);
  const g = c.getContext('2d'); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  return { mesh, draw(fn) { fn(g, c.width, c.height); tex.needsUpdate = true; } };
}
function wrap(g, text, x, y, maxW, lh) {
  let line = ''; for (const w of text.split(' ')) { const tl = line ? line + ' ' + w : w; if (g.measureText(tl).width > maxW && line) { g.fillText(line, x, y); line = w; y += lh; } else line = tl; } g.fillText(line, x, y); return y + lh;
}
function rr(g, x, y, w, h, r, fill) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill(); }

/** Phone UI. mode: 'lock' | 'message' | 'calling' | 'noanswer'. k = 0..1 reveal progress. */
function drawPhone(g, W, H, mode, t, k = 1) {
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d1424'); bg.addColorStop(1, '#1d2b4f'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.fillStyle = '#fff';
  if (mode === 'lock' || mode === 'message') {
    g.font = '300 150px Inter'; g.fillText('12:00', W / 2, 230); g.font = '500 34px Inter'; g.fillStyle = '#c7d2ee'; g.fillText('Tuesday', W / 2, 290);
    const cardY = 380, alpha = mode === 'lock' ? 1 : 1;
    g.globalAlpha = alpha; rr(g, 30, cardY, W - 60, mode === 'message' ? 380 : 150, 34, 'rgba(255,255,255,0.14)');
    g.textAlign = 'left'; g.fillStyle = '#ff5a5a'; g.font = '800 42px Inter'; g.fillText('UNKNOWN', 64, cardY + 60);
    g.fillStyle = '#9aa8c8'; g.font = '500 28px Inter'; g.textAlign = 'right'; g.fillText('now', W - 64, cardY + 56); g.textAlign = 'left';
    g.fillStyle = '#ffffff'; g.font = '800 50px Inter';
    if (mode === 'lock') g.fillText('New message', 64, cardY + 120);
    else ['They lied.', 'Missiles inbound.', 'Get underground.', 'NOW.'].forEach((ln, i) => { if (i < k) { g.fillStyle = i === 3 ? '#ff5a5a' : '#fff'; g.fillText(ln, 64, cardY + 125 + i * 64); } });
    g.globalAlpha = 1;
  } else {
    g.font = '600 40px Inter'; g.fillStyle = '#c7d2ee'; g.fillText(mode === 'calling' ? 'calling…' : 'No answer', W / 2, 200);
    g.beginPath(); g.arc(W / 2, 400, 120, 0, 7); g.fillStyle = '#3b6fb6'; g.fill();
    g.fillStyle = '#fff'; g.font = '800 120px Inter'; g.fillText('L', W / 2, 445);
    g.font = '800 70px Inter'; g.fillText('Leo', W / 2, 640);
    if (mode === 'calling') { for (let i = 0; i < 3; i++) { g.globalAlpha = 0.3 + 0.7 * (Math.floor(t * 3) % 3 === i ? 1 : 0); g.beginPath(); g.arc(W / 2 - 40 + i * 40, 720, 10, 0, 7); g.fill(); } g.globalAlpha = 1; }
    else { g.fillStyle = '#ff5a5a'; g.font = '800 44px Inter'; g.fillText('Call failed', W / 2, 730); }
    g.beginPath(); g.arc(W / 2, H - 160, 64, 0, 7); g.fillStyle = mode === 'calling' ? '#e5484d' : '#555'; g.fill();
  }
}

function phoneModel(THREE, lib) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.56, 0.08), lib.mat('#0b0d12', { roughness: 0.3, metalness: 0.4 })); g.add(body);
  const scr = screen(THREE, 0.7, 1.48, 600); scr.mesh.position.z = 0.041; g.add(scr.mesh);
  return { group: g, screen: scr };
}

/** Grey, ash-covered outside world seen through the shelter camera. glitch 0..1, figure 0..1 (hint). */
function drawFeed(g, W, H, day, t, glitch = 0, figure = 0) {
  const sky = g.createLinearGradient(0, 0, 0, H * 0.6); sky.addColorStop(0, '#6c6e72'); sky.addColorStop(1, '#a3a29c'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = '#4a4946'; g.fillRect(0, H * 0.6, W, H * 0.4);
  // dead tree + fence
  g.strokeStyle = '#2a2927'; g.lineWidth = 6; g.beginPath(); g.moveTo(W * 0.22, H * 0.62); g.lineTo(W * 0.22, H * 0.3); g.lineTo(W * 0.15, H * 0.2); g.moveTo(W * 0.22, H * 0.38); g.lineTo(W * 0.3, H * 0.27); g.stroke();
  for (let x = 0.45; x < 1; x += 0.07) { g.fillStyle = '#33322f'; g.fillRect(W * x, H * 0.52, 6, H * 0.09); }
  g.fillRect(W * 0.45, H * 0.54, W * 0.55, 4);
  if (figure > 0) { // barely-there silhouette: something very tall with long arms
    g.globalAlpha = figure * 0.85; g.fillStyle = '#111'; const fx = W * 0.68, fy = H * 0.61, h = H * 0.42;
    g.beginPath(); g.ellipse(fx, fy - h * 0.92, h * 0.07, h * 0.09, 0, 0, 7); g.fill();
    g.fillRect(fx - h * 0.06, fy - h * 0.82, h * 0.12, h * 0.45);
    g.fillRect(fx - h * 0.04, fy - h * 0.38, h * 0.03, h * 0.38); g.fillRect(fx + h * 0.01, fy - h * 0.38, h * 0.03, h * 0.38);
    g.save(); g.translate(fx - h * 0.06, fy - h * 0.78); g.rotate(0.12); g.fillRect(-h * 0.025, 0, h * 0.025, h * 0.62); g.beginPath(); g.ellipse(-h * 0.012, h * 0.66, h * 0.05, h * 0.07, 0, 0, 7); g.fill(); g.restore();
    g.save(); g.translate(fx + h * 0.06, fy - h * 0.78); g.rotate(-0.1); g.fillRect(0, 0, h * 0.025, h * 0.62); g.beginPath(); g.ellipse(h * 0.012, h * 0.66, h * 0.05, h * 0.07, 0, 0, 7); g.fill(); g.restore();
    g.globalAlpha = 1;
  }
  // falling ash + grain
  let s = Math.floor(t * 12) * 7919 + day * 131; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgba(220,220,215,0.7)'; for (let i = 0; i < 70; i++) g.fillRect(r() * W, r() * H, 2, 2);
  g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 400; i++) g.fillRect(r() * W, r() * H, 2, 2);
  if (glitch > 0) { for (let i = 0; i < 18 * glitch; i++) { const y = r() * H, h = 4 + r() * 30; g.fillStyle = `rgba(${r() < 0.5 ? 255 : 200},${200 + r() * 55},${200 + r() * 55},${0.2 + r() * 0.5})`; g.fillRect(0, y, W, h); } }
  g.fillStyle = '#fff'; g.font = '700 30px monospace'; g.textAlign = 'left'; g.fillText(`CAM 1  DAY ${day}`, 18, 40);
  g.fillStyle = Math.floor(t * 2) % 2 ? '#ff3b3b' : 'rgba(0,0,0,0)'; g.beginPath(); g.arc(W - 30, 30, 10, 0, 7); g.fill();
}
function drawCalendar(g, W, H, crossed, circled = -1) {
  g.fillStyle = '#efe8d8'; g.fillRect(0, 0, W, H); g.fillStyle = '#b3261e'; g.fillRect(0, 0, W, 90);
  g.fillStyle = '#fff'; g.font = '900 54px Inter'; g.textAlign = 'center'; g.fillText('14 DAYS', W / 2, 64);
  for (let i = 0; i < 14; i++) {
    const cx = 20 + (i % 7) * ((W - 40) / 7), cy = 110 + Math.floor(i / 7) * 150, w = (W - 40) / 7 - 8;
    g.strokeStyle = '#555'; g.lineWidth = 3; g.strokeRect(cx, cy, w, 135); g.fillStyle = '#333'; g.font = '700 34px Inter'; g.fillText(String(i + 1), cx + w / 2, cy + 42);
    if (i < crossed) { g.strokeStyle = '#b3261e'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx + 10, cy + 55); g.lineTo(cx + w - 10, cy + 125); g.moveTo(cx + w - 10, cy + 55); g.lineTo(cx + 10, cy + 125); g.stroke(); }
    if (i === circled) { g.strokeStyle = '#b3261e'; g.lineWidth = 6; g.beginPath(); g.ellipse(cx + w / 2, cy + 70, w * 0.6, 70, 0, 0, 7); g.stroke(); }
  }
}

// ---------- sets ----------
function bedroom({ THREE, scene, lib }) {
  scene.background = new THREE.Color('#03050b');
  const room = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 7), lib.mat('#1d2540', { side: THREE.BackSide })); room.position.y = 1.6; room.receiveShadow = true; scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), lib.mat('#4a3424')); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true; scene.add(floor);
  const bed = new THREE.Group(); bed.position.set(-0.6, 0, -2.0); scene.add(bed);
  const base = new THREE.Mesh(new THREE.BoxGeometry(2, 0.45, 3), lib.mat('#3a2a1e')); base.position.y = 0.22; bed.add(base);
  const matt = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 2.9), lib.mat('#d8dde8')); matt.position.y = 0.57; bed.add(matt);
  const head = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 0.12), lib.mat('#3a2a1e')); head.position.set(0, 0.8, -1.5); bed.add(head);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.5), lib.mat('#f2f4f8')); pillow.position.set(0, 0.78, -1.1); bed.add(pillow);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 1.9), lib.mat('#34508f')); blanket.position.set(0, 0.76, 0.45); bed.add(blanket);
  bed.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  const you = lib.person({ shirt: '#5a7bbf', pants: '#34508f' }); you.rotation.x = -Math.PI / 2; you.position.set(-0.6, 0.72, -0.85); scene.add(you);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.5), lib.mat('#3a2a1e')); stand.position.set(0.85, 0.3, -3.0); stand.castShadow = stand.receiveShadow = true; scene.add(stand);
  const ph = phoneModel(THREE, lib); ph.group.rotation.x = -Math.PI / 2; ph.group.scale.setScalar(0.25); ph.group.position.set(0.85, 0.615, -3.0); scene.add(ph.group);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ color: '#2d3f80' })); win.position.set(-3.48, 1.9, -0.6); win.rotation.y = Math.PI / 2; scene.add(win);
  scene.add(new THREE.AmbientLight('#2a3566', 0.6));
  const moon = new THREE.DirectionalLight('#6d84d9', 0.8); moon.position.set(-6, 5, 0); moon.castShadow = true; scene.add(moon);
  const glowL = new THREE.PointLight('#9fc4ff', 0, 6, 1.5); glowL.position.set(0.85, 0.9, -3.0); scene.add(glowL);
  return { you, phone: ph, glowL };
}

function yard({ THREE, scene, lib }) {
  const env = lib.sky(scene, NIGHT); lib.starfield(scene, { count: 2000 }); lib.ground(scene, { color: '#24331f' });
  const house = lib.house({ color: '#b9b1a0', roof: '#4d2a24', w: 7, d: 5, h: 3 }); house.position.set(-7, 0, -9); scene.add(house);
  const winL = new THREE.PointLight('#ffd27a', 3, 10, 1.5); winL.position.set(-7, 1.6, -6); scene.add(winL);
  for (let i = 0; i < 16; i++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), lib.mat('#3d2e22')); post.position.set(-10 + i * 1.6, 0.6, -14); scene.add(post); }
  for (const [x, z, s] of [[8, -12, 1], [-14, -4, 2], [12, 6, 3]]) { const t = lib.tree({ height: 6, seed: s, color: '#1f3a22' }); t.position.set(x, 0, z); scene.add(t); }
  const hatch = new THREE.Group(); hatch.position.set(4, 0, -2); scene.add(hatch);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 1.7), lib.mat('#5d6166')); rim.position.y = 0.11; hatch.add(rim);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 1.2), new THREE.MeshBasicMaterial({ color: '#000' })); hole.position.y = 0.2; hatch.add(hole);
  const hinge = new THREE.Group(); hinge.position.set(0, 0.24, -0.62); hatch.add(hinge);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.3), lib.mat('#7d858c', { metalness: 0.6, roughness: 0.4 })); lid.position.z = 0.65; hinge.add(lid);
  hatch.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  const you = lib.person({ shirt: '#5a7bbf', pants: '#2b3a55' }); scene.add(you);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.22), lib.mat('#3f5a2a')); bag.position.set(0, 1.25, -0.3); you.add(bag);
  return { env, hatch, hinge, you };
}

function shelter({ THREE, scene, lib }) {
  scene.background = new THREE.Color('#000');
  const concrete = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#7b7e80'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); return t; })();
  const room = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 6), lib.mat('#ffffff', { map: concrete, side: THREE.BackSide, roughness: 0.95 })); room.position.y = 1.3; room.receiveShadow = true; scene.add(room);
  const add = (geo, color, x, y, z, o = {}) => { const m = new THREE.Mesh(geo, lib.mat(color, o)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  // shelves (left wall) with water and food
  for (const y of [0.25, 0.85, 1.45, 2.0]) add(new THREE.BoxGeometry(0.45, 0.04, 2.0), '#6b4f35', -1.75, y, -1.3);
  for (const z of [-2.28, -0.32]) add(new THREE.BoxGeometry(0.45, 2.0, 0.05), '#5a412b', -1.75, 1.0, z);
  for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 16), '#5fa8e8', -1.75, 0.48, -2.05 + i * 0.36, { transparent: true, opacity: 0.8, roughness: 0.2 });
  for (let i = 0; i < 12; i++) add(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 14), ['#c0392b', '#e1a32b', '#4e8f3a', '#9aa0a6'][i % 4], -1.7 + (i % 2) * -0.12, 0.94 + Math.floor(i / 6) * 0.6, -2.1 + (i % 6) * 0.3, { metalness: 0.5 });
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.3, 0.22, 0.25), '#b08d5a', -1.75, 1.58 + 0, -2.0 + i * 0.45);
  // cot (right wall)
  // bunk bed (right wall)
  for (const [x, z] of [[1.15, -0.35], [1.95, -0.35], [1.15, 1.55], [1.95, 1.55]]) add(new THREE.BoxGeometry(0.05, 1.9, 0.05), '#4a4f55', x, 0.95, z, { metalness: 0.7 });
  for (const y of [0.4, 1.35]) { add(new THREE.BoxGeometry(0.85, 0.06, 1.95), '#4a4f55', 1.55, y, 0.6, { metalness: 0.6 }); add(new THREE.BoxGeometry(0.8, 0.12, 1.85), '#7d8f62', 1.55, y + 0.09, 0.6); add(new THREE.BoxGeometry(0.5, 0.1, 0.32), '#e8e4da', 1.55, y + 0.2, -0.1); add(new THREE.BoxGeometry(0.82, 0.08, 1.1), '#7a2f2f', 1.55, y + 0.17, 0.95); }
  add(new THREE.BoxGeometry(0.4, 0.3, 0.35), '#b08d5a', 1.5, 1.68, 1.1); add(new THREE.BoxGeometry(0.35, 0.25, 0.3), '#9c7a48', 1.6, 1.66, 0.5);
  // photo of you and Leo, taped above the bunk
  const photo = screen(THREE, 0.32, 0.24, 320); photo.draw((g, W, H) => { g.fillStyle = '#f4efe2'; g.fillRect(0, 0, W, H); g.fillStyle = '#7fb3e0'; g.fillRect(14, 14, W - 28, H - 70); g.fillStyle = '#4e8f3a'; g.fillRect(14, H - 110, W - 28, 54); for (const [x, c] of [[0.36, '#5a7bbf'], [0.64, '#e9a23b']]) { g.fillStyle = '#f0c08a'; g.beginPath(); g.arc(W * x, 80, 22, 0, 7); g.fill(); g.fillStyle = c; g.fillRect(W * x - 22, 104, 44, 70); } g.fillStyle = '#333'; g.font = '700 30px Inter'; g.textAlign = 'center'; g.fillText('ME & LEO', W / 2, H - 18); }); photo.mesh.position.set(1.985, 2.1, 0.9); photo.mesh.rotation.set(0, -Math.PI / 2, 0.06); scene.add(photo.mesh);
  // first-aid kit, gas mask, flashlight, toolbox, water crates, books, rug, clock, map, pipes, battery bank
  const aid = screen(THREE, 0.36, 0.26, 256); aid.draw((g, W, H) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, W, H); g.fillStyle = '#d32f2f'; g.fillRect(W / 2 - 18, 30, 36, H - 60); g.fillRect(W / 2 - 62, H / 2 - 18, 124, 36); }); aid.mesh.position.set(0.25, 1.75, -2.945); scene.add(aid.mesh);
  add(new THREE.BoxGeometry(0.38, 0.28, 0.1), '#e6e6e6', 0.25, 1.75, -3.0);
  const mask = new THREE.Group(); mask.position.set(-0.85, 1.5, -2.93); scene.add(mask);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), lib.mat('#2e3530', { roughness: 0.6 })); face.scale.set(1, 1.2, 0.6); mask.add(face);
  for (const x of [-0.06, 0.06]) { const eye = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), lib.mat('#9fb7c4', { metalness: 0.5, roughness: 0.1 })); eye.position.set(x, 0.04, 0.08); mask.add(eye); }
  const filt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), lib.mat('#6b6f4a')); filt.rotation.x = Math.PI / 2; filt.position.set(0, -0.08, 0.09); mask.add(filt);
  const torch = add(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 12), '#f2c230', 1.35, 0.84, -2.35); torch.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(0.5, 0.22, 0.25), '#b3261e', -1.3, 0.11, 0.5, { metalness: 0.3 });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) add(new THREE.BoxGeometry(0.34, 0.3, 0.34), '#3e6fa8', -1.7 + j * 0.36, 0.15 + i * 0.3, 0.05 + (i % 2) * 0.03);
  const crateTag = screen(THREE, 0.3, 0.1, 256); crateTag.draw((g, W, H) => { g.fillStyle = '#3e6fa8'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = '900 56px Inter'; g.textAlign = 'center'; g.fillText('WATER', W / 2, 66); }); crateTag.mesh.position.set(-1.34, 0.75, 0.23); scene.add(crateTag.mesh);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.22, 0.04, 0.3), ['#7a2f2f', '#2f4f7a', '#4e6b2f', '#7a6a2f'][i], 1.75, 0.84 + i * 0.04, -2.75);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.0), lib.mat('#6a3b2a')); rug.rotation.x = -Math.PI / 2; rug.position.set(0.1, 0.012, 0.5); rug.receiveShadow = true; scene.add(rug);
  const matE = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.6), lib.mat('#2f6fb0')); matE.rotation.set(-Math.PI / 2, 0, Math.PI / 2); matE.position.set(0.0, 0.02, -0.6); scene.add(matE);
  const clock = screen(THREE, 0.26, 0.26, 256); clock.mesh.position.set(-1.985, 2.1, 0.0); clock.mesh.rotation.y = Math.PI / 2; scene.add(clock.mesh);
  const map = screen(THREE, 0.7, 0.5, 400); map.draw((g, W, H) => { g.fillStyle = '#e8dfc4'; g.fillRect(0, 0, W, H); g.strokeStyle = '#8fb0c9'; g.lineWidth = 10; g.beginPath(); g.moveTo(0, H * 0.7); g.bezierCurveTo(W * 0.3, H * 0.5, W * 0.6, H * 0.9, W, H * 0.6); g.stroke(); g.strokeStyle = '#a89b7a'; g.lineWidth = 3; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, i * 40); g.lineTo(W, i * 40 + 20); g.stroke(); } g.fillStyle = '#d32f2f'; for (const [x, y] of [[0.3, 0.3], [0.62, 0.45], [0.75, 0.2]]) { g.beginPath(); g.arc(W * x, H * y, 9, 0, 7); g.fill(); } g.strokeStyle = '#d32f2f'; g.lineWidth = 4; g.beginPath(); g.arc(W * 0.62, H * 0.45, 40, 0, 7); g.stroke(); g.fillStyle = '#333'; g.font = '700 26px Inter'; g.fillText("LEO'S HOUSE", W * 0.5, H * 0.62); }); map.mesh.position.set(-0.6, 1.6, 2.98); map.mesh.rotation.y = Math.PI; scene.add(map.mesh);
  for (const z of [-2.9]) { const pipe = add(new THREE.CylinderGeometry(0.04, 0.04, 6), '#6f747a', 0, 2.5, 0, { metalness: 0.8 }); pipe.rotation.x = Math.PI / 2; pipe.position.set(-1.85, 2.48, 0); }
  add(new THREE.BoxGeometry(0.5, 0.35, 0.3), '#23282e', -1.65, 0.17, -2.7, { metalness: 0.4 });
  const batt = screen(THREE, 0.3, 0.14, 256); batt.mesh.position.set(-1.65, 0.22, -2.545); scene.add(batt.mesh);
  // table with monitor and radio (back right)
  add(new THREE.BoxGeometry(1.3, 0.06, 0.65), '#5a412b', 1.1, 0.78, -2.6);
  for (const [x, z] of [[0.52, -2.35], [1.68, -2.35], [0.52, -2.85], [1.68, -2.85]]) add(new THREE.BoxGeometry(0.05, 0.78, 0.05), '#3d2c1d', x, 0.39, z);
  add(new THREE.BoxGeometry(0.62, 0.44, 0.08), '#15171b', 0.75, 1.1, -2.82);
  const feed = screen(THREE, 0.56, 0.38, 420); feed.mesh.position.set(0.75, 1.1, -2.775); scene.add(feed.mesh);
  const radio = new THREE.Group(); radio.position.set(1.4, 0.95, -2.6); scene.add(radio);
  const rb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.2), lib.mat('#6e4b2a', { roughness: 0.5 })); rb.castShadow = true; radio.add(rb);
  const grill = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), lib.mat('#222')); grill.position.set(-0.12, 0, 0.101); radio.add(grill);
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.07), new THREE.MeshBasicMaterial({ color: '#3a2a10' })); dial.position.set(0.11, 0.04, 0.101); radio.add(dial);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: '#331100' })); led.position.set(0.18, -0.07, 0.105); radio.add(led);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5), lib.mat('#aaa', { metalness: 0.9 })); ant.position.set(0.2, 0.36, 0); ant.rotation.z = -0.3; radio.add(ant);
  const radioGlow = lib.glow('#ffb35c', 0.5, 0); radioGlow.position.set(0.11, 0.04, 0.12); radio.add(radioGlow);
  // vent + fan, solar controller (back wall, left)
  add(new THREE.BoxGeometry(0.55, 0.55, 0.06), '#55595e', -1.15, 2.05, -2.97, { metalness: 0.6 });
  const fan = new THREE.Group(); fan.position.set(-1.15, 2.05, -2.92); scene.add(fan);
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.01), lib.mat('#2c2f33')); b.position.y = 0.1; const piv = new THREE.Group(); piv.rotation.z = (i * Math.PI) / 2; piv.add(b); fan.add(piv); }
  add(new THREE.BoxGeometry(0.4, 0.3, 0.08), '#2f3f2f', -1.15, 1.2, -2.95);
  const solarLed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: '#2aff6a' })); solarLed.position.set(-1.05, 1.25, -2.9); scene.add(solarLed);
  const solarTag = screen(THREE, 0.3, 0.08, 256); solarTag.draw((g, W, H) => { g.fillStyle = '#1b241b'; g.fillRect(0, 0, W, H); g.fillStyle = '#cfe8c8'; g.font = '800 44px Inter'; g.textAlign = 'center'; g.fillText('SOLAR', W / 2, 52); }); solarTag.mesh.position.set(-1.2, 1.15, -2.905); scene.add(solarTag.mesh);
  // ladder + hatch (back wall, centre)
  for (const x of [-0.55, -0.05]) add(new THREE.CylinderGeometry(0.03, 0.03, 2.6), '#8a9097', x, 1.3, -2.85, { metalness: 0.7 });
  for (let y = 0.3; y < 2.6; y += 0.32) { const rung = add(new THREE.CylinderGeometry(0.02, 0.02, 0.5), '#8a9097', -0.3, y, -2.85, { metalness: 0.7 }); rung.rotation.z = Math.PI / 2; }
  add(new THREE.BoxGeometry(0.8, 0.05, 0.8), '#5d6166', -0.3, 2.58, -2.6, { metalness: 0.6 });
  const leak = lib.glow('#fff6dd', 0.9, 0.0); leak.position.set(-0.3, 2.52, -2.6); scene.add(leak);
  // calendar (right wall)
  const cal = screen(THREE, 0.7, 0.5, 512); cal.mesh.position.set(1.2, 1.95, -2.985); scene.add(cal.mesh);
  // bulb
  const cord = new THREE.Group(); cord.position.set(0, 2.6, -0.6); scene.add(cord);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35), lib.mat('#111')); wire.position.y = -0.17; cord.add(wire);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff1c9' })); bulb.position.y = -0.38; cord.add(bulb);
  const light = new THREE.PointLight('#ffd08a', 4, 0, 1.2); light.position.y = -0.4; light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.bias = -0.003; light.shadow.normalBias = 0.04; cord.add(light);
  scene.add(new THREE.AmbientLight('#3a3530', 0.35));
  const you = lib.person({ shirt: '#5a7bbf', pants: '#2b3a55' }); scene.add(you);
  /** flicker 0..1 amount, swing radians */
  const setLight = (t, flicker = 0, swing = 0) => { const f = 1 - flicker * (Math.sin(t * 53) > 0.6 ? 0.8 : 0) * (Math.sin(t * 7.1) > 0 ? 1 : 0.3); light.intensity = 4 * f; bulb.material.color.setScalar(0.35 + 0.65 * f); cord.rotation.z = swing; cord.rotation.x = swing * 0.4; };
  /** per-frame props: wall clock, battery level */
  const tick = (t, charge = 0.7) => {
    clock.draw((g, W, H) => { g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 4, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 8; g.stroke(); const hh = t * 0.05, mm = t * 0.6; for (const [a, l, w] of [[hh, 0.25, 9], [mm, 0.38, 5]]) { g.lineWidth = w; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(a) * W * l, H / 2 - Math.cos(a) * W * l); g.stroke(); } });
    batt.draw((g, W, H) => { g.fillStyle = '#0d1410'; g.fillRect(0, 0, W, H); for (let i = 0; i < 5; i++) { g.fillStyle = i < Math.round(charge * 5) ? '#2aff6a' : '#1e3326'; g.fillRect(14 + i * 46, 26, 36, H - 52); } });
  };
  tick(0);
  return { you, feed, cal, radio, led, radioGlow, fan, solarLed, leak, light, setLight, tick };
}

const BOARD = [
  ['SUPPLIES', 0, '#1a1a1a'], ['WATER: 40 L', 1, '#1f4fa0'], ['  2 L a day = 20 DAYS', 1, '#1f4fa0'],
  ['FOOD: 50 cans', 2, '#1f7a2f'], ['  3 a day = ~16 DAYS', 2, '#1f7a2f'], ['AIR: filter OK', 3, '#1a1a1a'], ['POWER: solar, day only', 3, '#1a1a1a'],
];
/** Whiteboard with handwritten supply math. k = number of characters revealed (progress through BOARD). */
function drawBoard(g, W, H, k, tight = false) {
  g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, W, H); let left = k;
  BOARD.forEach(([txt, , col], i) => {
    if (left <= 0) return; const shown = txt.slice(0, Math.max(0, Math.floor(left))); left -= txt.length;
    g.fillStyle = col; g.font = i === 0 ? 'italic 900 60px Inter' : 'italic 700 46px Inter'; g.textAlign = 'left';
    g.save(); g.translate(40, 78 + i * 62); g.rotate(-0.01 + (i % 2) * 0.012); g.fillText(shown, 0, 0); g.restore();
    if (i === 0 && shown.length === txt.length) { g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.moveTo(40, 92); g.lineTo(330, 88); g.stroke(); }
  });
  if (tight) { g.strokeStyle = '#d32f2f'; g.lineWidth = 7; g.beginPath(); g.ellipse(W * 0.55, 78 + 4 * 62 - 14, 300, 44, -0.02, 0, 7); g.stroke(); g.fillStyle = '#d32f2f'; g.font = 'italic 900 64px Inter'; g.fillText('TIGHT!', W - 250, H - 30); }
}
function drawNotebook(g, W, H, k, tight = false) {
  g.fillStyle = '#fbf8ef'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#b9cfe8'; g.lineWidth = 2; for (let y = 140; y < H - 20; y += 72) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = '#e8a0a0'; g.beginPath(); g.moveTo(70, 0); g.lineTo(70, H); g.stroke();
  for (let x = 40; x < W; x += 52) { g.fillStyle = '#555'; g.beginPath(); g.arc(x, 26, 10, 0, 7); g.fill(); }
  let left = k, pen = [0.2, 0.15];
  BOARD.forEach(([txt], i) => {
    const y = 128 + i * 72; if (left <= 0) return;
    const shown = txt.trim().slice(0, Math.max(0, Math.floor(left))); left -= txt.length;
    g.fillStyle = i === 0 ? '#14213d' : '#1d3f9a'; g.font = i === 0 ? 'italic 900 52px Inter' : `italic ${txt.startsWith(' ') ? 600 : 800} 40px Inter`; g.textAlign = 'left';
    const xi = 88 + (txt.startsWith(' ') ? 34 : 0); g.save(); g.translate(xi, y); g.rotate(-0.015); g.fillText(shown, 0, 0); g.restore();
    pen = [Math.min(0.95, (xi + g.measureText(shown).width) / W), (y - 12) / H];
  });
  if (tight) { g.strokeStyle = '#c62828'; g.lineWidth = 5; g.beginPath(); g.ellipse(W * 0.5, 128 + 4 * 72 - 14, W * 0.42, 38, -0.02, 0, 7); g.stroke(); g.fillStyle = '#c62828'; g.font = 'italic 900 64px Inter'; g.fillText('TIGHT!', 150, H - 50); pen = [0.62, (H - 70) / H]; }
  return pen;
}
const boardLen = (upto) => BOARD.filter(([, c]) => c <= upto).reduce((a, [t]) => a + t.length, 0);

/** Exercise poses for the person rig (pure functions of t). */
function resetPose(p) { p.rotation.order = 'YXZ'; p.rotation.set(0, p.rotation.y, 0); const P = p.parts; for (const k of ['armL', 'armR', 'legL', 'legR']) P[k].rotation.set(0, 0, 0); P.armL.rotation.z = -0.08; P.armR.rotation.z = 0.08; P.torso.rotation.set(0, 0, 0); P.head.rotation.set(0, 0, 0); }
function pushup(p, t, y0 = 0) { resetPose(p); const k = 0.5 - 0.5 * Math.cos(t * 5), th = 0.42 - k * 0.2, phi = Math.PI / 2 - th; p.rotation.x = phi; p.position.y = y0 + 0.06; p.parts.armL.rotation.x = p.parts.armR.rotation.x = -phi; p.parts.head.rotation.x = -0.5; return k; }
function squat(p, t, y0 = 0) { resetPose(p); const k = 0.5 - 0.5 * Math.cos(t * 4.5); p.position.y = y0 - k * 0.42; p.parts.legL.rotation.x = p.parts.legR.rotation.x = -k * 1.0; p.parts.torso.rotation.x = k * 0.25; p.parts.armL.rotation.x = p.parts.armR.rotation.x = -1.5 * k - 0.2; return k; }
function jacks(p, t, y0 = 0) { resetPose(p); const k = 0.5 - 0.5 * Math.cos(t * 7); p.position.y = y0 + Math.abs(Math.sin(t * 3.5)) * 0.12; p.parts.armL.rotation.z = -0.15 - k * 2.6; p.parts.armR.rotation.z = 0.15 + k * 2.6; p.parts.legL.rotation.z = -k * 0.3; p.parts.legR.rotation.z = k * 0.3; return k; }
function lie(p) { resetPose(p); p.rotation.set(-Math.PI / 2, 0, 0); p.position.set(1.55, p.isStick ? 0.62 : 0.82, 1.5); p.parts.head.rotation.y = 0.3; }
const chunkIndex = (chunks, t) => { let i = 0; chunks.forEach((c, j) => { if (t >= c) i = j; }); return i; };

/** Overhead suburb with "your house" lot. */
function suburbAbove(ctx, { ash = false, offset = [0, 0, 0] } = {}) {
  const { scene, lib } = ctx;
  const town = lib.topDownTown({ kind: 'suburb', seed: 11, crowd: 0, cars: ash ? 0 : 10, ash }); town.position.set(...offset); scene.add(town);
  const home = town.lots.reduce((a, b) => (Math.hypot(b.x - 35, b.z - 35) < Math.hypot(a.x - 35, a.z - 35) ? b : a));
  return { town, home, hx: home.x + offset[0], hz: home.z + offset[2], dz: home.dz };
}
function shadowFigure(THREE) { // long, thin, long-armed shadow (never the creature itself)
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.75)'; g.filter = 'blur(6px)';
  g.beginPath(); g.ellipse(128, 70, 34, 46, 0, 0, 7); g.fill(); g.fillRect(104, 110, 48, 430); g.fillRect(108, 540, 14, 450); g.fillRect(134, 540, 14, 450);
  g.save(); g.translate(104, 130); g.rotate(0.18); g.fillRect(-12, 0, 12, 470); g.beginPath(); g.ellipse(-6, 490, 26, 40, 0, 0, 7); g.fill(); g.restore();
  g.save(); g.translate(152, 130); g.rotate(-0.18); g.fillRect(0, 0, 12, 470); g.beginPath(); g.ellipse(6, 490, 26, 40, 0, 0, 7); g.fill(); g.restore();
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 12), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.userData.outlineParameters = { visible: false }; m.material.userData.outlineParameters = { visible: false }; return m;
}

const RED = '#ff5a5a';

export default {
  // voice comes from the skill default (American male blend) unless set here
  narration: false,      // narrator is added in the TikTok app (TikTok text-to-speech); timing + music ducking still follow the script
  style: 'ink',          // hand-drawn look: toon shading, ink outlines, stick figures
  voice: 'am_onyx',      // very deep storyteller voice
  voicePitch: 0.92,      // a touch deeper still
  speed: 1.13,
  music: { style: 'tense', volume: 0.15 },
  scenes: [
    { // 1 hook
      vo: 'Imagine you wake up at midnight, when your phone buzzes.',
      sfx: [{ type: 'buzz', at: 0.3 }, { type: 'buzz', at: 1.9 }],
      build(ctx) {
        const { camera, lib } = ctx; const s = bedroom(ctx);
        s.phone.screen.draw((g, W, H) => drawPhone(g, W, H, 'lock', 0));
        return (t, p) => {
          const buzzing = (t > 0.3 && (t - 0.3) % 1.6 < 1.3) && ((t * 1000) % 800 < 450);
          s.phone.group.position.x = 0.85 + (buzzing ? Math.sin(t * 90) * 0.01 : 0);
          s.glowL.intensity = t > 0.3 ? 2.5 : 0; s.phone.screen.mesh.visible = t > 0.3;
          s.you.parts.head.rotation.y = -lib.easeRange(t, 1.6, 2.4) * 0.7;
          camera.position.set(lib.lerp(2.4, 1.9, p), lib.lerp(2.3, 1.9, p), lib.lerp(-0.4, -1.0, p)); camera.lookAt(0.3, 0.6, -2.6);
        };
      },
    },
    { // 2 the message
      vo: "It's a message from an unknown number. | They lied. | Missiles are coming. | Get underground. | Now!",
      sfx: [{ type: 'heartbeat', at: 1.5 }, { type: 'heartbeat', at: 2.6 }, { type: 'heartbeat', at: 3.6 }],
      build(ctx) {
        const { THREE, scene, camera, lib, fx } = ctx;
        scene.background = new THREE.Color('#05070d');
        const ph = phoneModel(THREE, lib); scene.add(ph.group); scene.add(new THREE.AmbientLight('#fff', 0.5));
        const halo = lib.glow('#5f8cff', 3.5, 0.35); halo.position.z = -0.3; scene.add(halo);
        camera.position.set(0, 0, 2.3); camera.lookAt(0, 0, 0);
        return (t, p) => {
          ph.screen.draw((g, W, H) => drawPhone(g, W, H, 'message', t, chunkIndex(ctx.chunks, t)));
          ph.group.rotation.set(-0.08 + Math.sin(t * 1.3) * 0.02, 0.12 - p * 0.1, 0.02);
          camera.position.z = 2.3 - p * 0.35; fx.vignette = 0.7;
        };
      },
    },
    { // 3 the news lies
      vo: 'You turn on the news. | Nothing.',
      sfx: [{ type: 'pop', at: 0.2 }],
      build(ctx) {
        const { THREE, scene, camera, lib } = ctx; const s = bedroom(ctx);
        s.you.visible = false;
        const tv = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 0.08), lib.mat('#0b0c10')); tv.position.set(3.4, 1.6, -0.6); tv.rotation.y = -Math.PI / 2; scene.add(tv);
        const scr = screen(THREE, 1.6, 0.9, 800); scr.mesh.position.set(3.355, 1.6, -0.6); scr.mesh.rotation.y = -Math.PI / 2; scene.add(scr.mesh);
        const tvL = new THREE.PointLight('#a9c6ff', 3, 7, 1.5); tvL.position.set(2.6, 1.6, -0.6); scene.add(tvL);
        const viewer = lib.person({ shirt: '#5a7bbf', pants: '#34508f' }); viewer.position.set(0.9, 0, -0.4); viewer.rotation.y = Math.PI / 2; scene.add(viewer);
        return (t, p) => {
          scr.draw((g, W, H) => {
            g.fillStyle = '#0f3f8f'; g.fillRect(0, 0, W, H); g.fillStyle = '#d61f1f'; g.fillRect(0, 0, W, 90);
            g.fillStyle = '#fff'; g.font = '900 56px Inter'; g.textAlign = 'left'; g.fillText('LIVE', 30, 66);
            g.textAlign = 'center'; g.font = '900 96px Inter'; g.fillText('NO THREAT', W / 2, 230); g.font = '600 40px Inter'; g.fillText('Officials: "Stay calm. Go back to sleep."', W / 2, 300);
            g.fillStyle = '#0a0a0a'; g.fillRect(0, H - 70, W, 70); g.fillStyle = '#ffd34d'; g.font = '700 34px Inter'; g.textAlign = 'left';
            g.fillText('EVERYTHING IS FINE • NO MILITARY ACTIVITY • RUMORS ARE FALSE • EVERYTHING IS FINE •', 20 - ((t * 140) % 900), H - 24);
          });
          tvL.intensity = 2.5 + Math.sin(t * 13) * 0.4;
          viewer.parts.head.rotation.y = 0; lib.idle(viewer, t);
          camera.position.set(lib.lerp(-1.6, -1.2, p), 1.9, lib.lerp(1.6, 1.2, p)); camera.lookAt(2.6, 1.5, -0.7);
        };
      },
    },
    { // 3b overhead: nobody knows
      vo: "They're saying everything is fine. | Nobody else knows.",
      build(ctx) {
        const { scene, camera, lib } = ctx; lib.topDownLights(scene);
        const town = lib.topDownTown({ kind: 'city', seed: 3, crowd: 320, cars: 60 }); town.rotation.y = Math.PI / 4; scene.add(town);
        camera.far = 3000; camera.updateProjectionMatrix();
        return (t, p) => { town.update(t); camera.position.set(0, lib.lerp(95, 70, p), 0.01); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); };
      },
    },
    { // 4 Leo doesn't answer
      vo: 'You call your best friend, Leo. | It rings. | And rings. | No answer.',
      speed: 1.02, pause: 0.42, hold: 0.8,
      sfx: [{ type: 'ding', chunk: 1, gain: 0.4 }, { type: 'ding', chunk: 2, gain: 0.4 }, { type: 'hit', chunk: 3, gain: 0.5 }],
      build(ctx) {
        const { THREE, scene, camera, lib, fx } = ctx;
        scene.background = new THREE.Color('#05070d');
        const ph = phoneModel(THREE, lib); scene.add(ph.group); scene.add(new THREE.AmbientLight('#fff', 0.5));
        const halo = lib.glow('#5f8cff', 3.5, 0.3); halo.position.z = -0.3; scene.add(halo);
        camera.position.set(0, 0, 2.2); camera.lookAt(0, 0, 0);
        return (t, p) => {
          const fail = t > (ctx.chunks[3] ?? 2.5); ph.screen.draw((g, W, H) => drawPhone(g, W, H, fail ? 'noanswer' : 'calling', t));
          halo.material.color.set(fail ? '#ff4d4d' : '#5f8cff');
          ph.group.rotation.set(-0.05, -0.1 + p * 0.15, -0.03); camera.position.z = 2.2 - p * 0.25; fx.vignette = 0.7;
          if (fail && t < (ctx.chunks[3] ?? 2.5) + 0.3) lib.shake(camera, 0.02, t);
        };
      },
    },
    { // 5 run to the shelter
      vo: 'So you grab your bag and run to the old shelter in your backyard.',
      sfx: [{ type: 'footsteps', length: 4 }],
      build(ctx) {
        const { camera, lib } = ctx; const s = yard(ctx);
        return (t, p) => {
          const k = lib.range(t, 0, ctx.duration * 0.95); const x = lib.lerp(-5, 3.0, k), z = lib.lerp(1, -1.6, k);
          s.you.position.set(x, 0, z); s.you.rotation.y = Math.atan2(8, -2.6); lib.walk(s.you, t, 1.9); s.you.parts.torso.rotation.x = 0.2;
          camera.position.set(x - 1.2, 1.5, z + 3.6); camera.lookAt(x + 1.0, 1.0, z - 0.5);
        };
      },
    },
    { // 6 hatch slams, flash
      vo: 'The second the hatch slams shut, the sky turns white.',
      minDuration: 4.0,
      sfx: [{ type: 'hatch', at: 1.0 }, { type: 'boom', at: 1.5 }],
      build(ctx) {
        const { scene, camera, lib, fx } = ctx; const s = yard(ctx);
        const blast = lib.glow('#fff1d6', 10, 1); blast.position.set(-60, 12, -450); scene.add(blast);
        return (t) => {
          const down = lib.easeIn(lib.range(t, 0, 0.9)); s.you.position.set(4, -down * 2.2, -1.95); s.you.rotation.y = Math.PI; s.you.parts.armL.rotation.x = s.you.parts.armR.rotation.x = -2.8;
          s.you.visible = down < 0.95;
          s.hinge.rotation.x = -lib.lerp(1.9, 0, lib.easeIn(lib.range(t, 0.55, 1.0)));
          const b = Math.max(0, t - 1.5); blast.scale.setScalar(b > 0 ? 20 + b * 220 : 0.01); blast.material.opacity = b > 0 ? Math.max(0.3, 1 - b * 0.3) : 0;
          s.env.setColors(b > 0 ? '#3b2a3a' : NIGHT.top, b > 0 ? '#ffb27a' : NIGHT.bottom);
          fx.flash = b > 0 ? Math.max(0, 1 - b * 0.9) : 0;
          camera.position.set(6.5, 1.6, 2.8); camera.lookAt(3.0, 0.9, -3.5);
          if (b > 0) lib.shake(camera, 0.12 * Math.max(0, 1 - b * 0.5), t);
        };
      },
    },
    { // 7 inside
      vo: 'When the shaking stops, you check what you have down there.',
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 0)); s.feed.draw((g, W, H) => drawFeed(g, W, H, 1, 0, 1));
        return (t, p) => {
          s.setLight(t, 0.6 * Math.max(0, 1 - t / 3), Math.sin(t * 2.4) * 0.25 * Math.exp(-t / 2));
          s.you.position.set(-0.2, 0, -0.9); s.you.rotation.y = Math.PI + Math.sin(t * 0.9) * 0.6; lib.idle(s.you, t);
          s.fan.rotation.z = t * 6;
          camera.position.set(-0.7, 1.65, 2.6); { const k = lib.ease(p); camera.lookAt(lib.lerp(1.55, -0.5, k), lib.lerp(0.9, 1.3, k), lib.lerp(0.6, -2.6, k)); }
          fx.fade = Math.max(0, 1 - t * 0.9);
        };
      },
    },
    { // 8 inventory
      vo: 'Water. | Food. | Good airflow. | A camera to see outside. | And solar panels that only work when the sun is up.',
      speed: 1.02, pause: 0.45,
      sfx: [0, 1, 2, 3, 4].map((c) => ({ type: 'pop', chunk: c })),
      build(ctx) {
        const { THREE, scene, camera, lib } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 0)); s.you.position.set(1.5, 0, 1.6); s.you.rotation.y = Math.PI;
        const items = [
          ['WATER', [-1.75, 0.48, -1.3], 0.15], ['FOOD', [-1.75, 1.15, -1.3], 1.0], ['AIR VENT', [-1.15, 2.05, -2.9], 1.8],
          ['CAMERA', [0.75, 1.1, -2.75], 3.0], ['SOLAR POWER', [-1.15, 1.2, -2.9], 4.4],
        ].map(([txt, pos], i) => { const at = ctx.chunks[i] ?? i; const l = lib.label(txt, { height: 0.2, bg: 'rgba(20,20,20,.85)', color: '#ffd34d' }); l.position.set(pos[0] + (pos[2] < -2.5 ? 0.05 : 0.45), pos[1] + 0.22, pos[2] + 0.2); l.visible = false; scene.add(l); return { l, pos: new THREE.Vector3(...pos), at }; });
        const look = new THREE.Vector3();
        return (t) => {
          s.setLight(t); s.fan.rotation.z = t * 6; s.tick(t); s.feed.draw((g, W, H) => drawFeed(g, W, H, 1, t));
          let cur = 0; items.forEach((it, i) => { const shown = t >= it.at; it.l.visible = shown; if (shown) cur = i; const pop = lib.easeOut(lib.range(t, it.at, it.at + 0.15)); const sc = it.l.userData.base ??= it.l.scale.clone(); it.l.scale.copy(sc).multiplyScalar(0.6 + 0.4 * pop); });
          const a = items[cur].pos, b = items[Math.min(cur, items.length - 1)].pos;
          look.lerpVectors(a, b, 1);
          const tgt = camera.userData.tgt ??= look.clone(); tgt.lerp(look, 0.12);
          camera.position.set(tgt.x * 0.4 + 0.9, 1.55, tgt.z + 3.4); camera.lookAt(tgt);
        };
      },
    },
    { // 8b write it down (in a notebook)
      vo: "You write it all down. | Forty liters of water. That's about twenty days. | Fifty cans of food. Just over two weeks. | It's going to be tight.",
      speed: 1.02, pause: 0.5,
      sfx: [{ type: 'pop', chunk: 3, gain: 0.6 }],
      build(ctx) {
        const { THREE, scene, camera, lib, fx } = ctx; const s = shelter(ctx); const C = ctx.chunks;
        const NW = 0.3, NH = 0.42;
        const book = screen(THREE, NW, NH, 600); book.mesh.rotation.x = -Math.PI / 2; book.mesh.position.set(1.05, 0.815, -2.4); scene.add(book.mesh);
        const pen = new THREE.Group(); scene.add(pen);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.15, 10), lib.mat('#1f4fb0')); body.position.y = 0.075; pen.add(body);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.02, 10), lib.mat('#222')); tip.rotation.x = Math.PI; tip.position.y = -0.005; pen.add(tip);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), lib.mat('#f0c08a')); hand.scale.set(1, 0.7, 1.3); hand.position.set(0.035, 0.07, 0.05); pen.add(hand);
        pen.rotation.set(-0.45, 0, -0.35);
        const lamp = new THREE.PointLight('#ffe2b0', 1.5, 2, 1.5); lamp.position.set(1.05, 1.3, -2.2); scene.add(lamp);
        return (t, p) => {
          s.setLight(t); s.tick(t);
          const seg = chunkIndex(C, t), segStart = C[seg] ?? 0, segEnd = C[seg + 1] ?? ctx.duration;
          const k = boardLen(seg - 1) + (boardLen(seg) - boardLen(seg - 1)) * lib.range(t, segStart, segStart + (segEnd - segStart) * 0.75);
          let pp; book.draw((g, W, H) => { pp = drawNotebook(g, W, H, k, seg >= 3 && t > segStart + 0.3); });
          const wob = Math.sin(t * 22) * 0.003;
          pen.position.set(1.05 - NW / 2 + pp[0] * NW + wob, 0.82 + Math.abs(Math.sin(t * 11)) * 0.004, -2.4 - NH / 2 + pp[1] * NH);
          camera.position.set(1.05, lib.lerp(1.5, 1.4, p), lib.lerp(-2.0, -2.05, p)); camera.lookAt(1.05, 0.81, -2.41);
          fx.vignette = 0.6;
        };
      },
    },
    { // 9 the plan
      vo: 'You make a plan. | Two weeks underground, until the radiation outside gets weak enough.',
      sfx: [{ type: 'ding', at: 1.4, gain: 0.5 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx);
        return (t, p) => {
          s.setLight(t); s.tick(t); s.cal.draw((g, W, H) => drawCalendar(g, W, H, 0, t > 1.4 ? 0 : -1));
          s.you.position.set(0.15, 0, -1.9); s.you.rotation.y = Math.PI - 0.6; lib.idle(s.you, t);
          camera.position.set(lib.lerp(0.7, 1.0, p), 1.8, lib.lerp(-0.4, -1.0, p)); camera.lookAt(1.2, 1.9, -2.98);
          if (t > 1.4) { fx.title = 'DAY 1 / 14'; fx.titleY = 0.15; fx.titleColor = '#ffffff'; }
        };
      },
    },
    { // 10 routine montage
      vo: 'Every day, the same routine. | Ration the food. | Check the camera. | Work out. | Charge the batteries while the sun is up.',
      pause: 0.42,
      sfx: [{ type: 'whoosh', at: 0.1, gain: 0.5 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx);
        const spots = [[-1.1, -1.3, -Math.PI / 2], [0.75, -2.0, Math.PI], [0.0, -0.6, 0.4], null];
        const cams = [[[0.6, 1.6, 0.4], [-1.4, 1.1, -1.3]], [[0.2, 1.5, -0.6], [0.75, 1.1, -2.8]], [[0.55, 1.35, 2.9], [0.1, 0.95, -0.8]], [[-1.3, 1.55, 2.7], [1.45, 0.85, 0.55]]];
        return (t, p) => {
          const dayF = 1 + p * 1.99, day = Math.floor(dayF), phase = Math.floor((dayF - 1) * 4) % 4;
          s.setLight(t); s.fan.rotation.z = t * 6; s.tick(t * 40, phase === 3 ? (t * 3) % 1 : 0.4);
          s.cal.draw((g, W, H) => drawCalendar(g, W, H, day - 1));
          s.feed.draw((g, W, H) => drawFeed(g, W, H, day, t));
          const sp = spots[phase];
          if (phase === 3) lie(s.you);
          else { s.you.rotation.y = sp[2]; if (phase === 2) { jacks(s.you, t); s.you.position.x = sp[0]; s.you.position.z = sp[1]; } else { resetPose(s.you); s.you.position.set(sp[0], 0, sp[1]); lib.idle(s.you, t); s.you.parts.armR.rotation.x = phase === 0 ? -1.2 : -0.6; } }
          s.solarLed.material.color.set(phase === 3 ? '#103a1a' : '#2aff6a'); s.setLight(t, 0); if (phase === 3) s.light.intensity = 2.6;
          const cm = cams[phase]; camera.position.set(...cm[0]); camera.lookAt(...cm[1]);
          fx.title = `DAY ${day}`; fx.titleY = 0.12; fx.titleSize = 90;
        };
      },
    },
    { // 10b daily workout
      vo: 'And every single day, you work out. | Push-ups. | Squats. | Jumping jacks. | You have to stay strong.',
      pause: 0.5,
      sfx: [1, 2, 3].map((c) => ({ type: 'hit', chunk: c, gain: 0.35 })),
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx); const C = ctx.chunks;
        const names = ['PUSH-UPS', 'PUSH-UPS', 'SQUATS', 'JUMPING JACKS', 'JUMPING JACKS'];
        return (t, p) => {
          s.setLight(t); s.fan.rotation.z = t * 6; s.tick(t * 20);
          const i = chunkIndex(C, t), local = t - (C[i] ?? 0);
          s.you.position.set(i <= 1 ? -0.85 : 0.15, 0, i <= 1 ? -0.6 : -0.8); s.you.rotation.y = i <= 1 ? Math.PI / 2 : 0.3;
          if (i <= 1) pushup(s.you, local);
          else if (i === 2) squat(s.you, local); else jacks(s.you, local);
          const reps = Math.floor(local * (i <= 1 ? 5 : i === 2 ? 4.5 : 7) / (Math.PI * 2)) + 1;
          fx.title = `${names[i]} x${reps}`; fx.titleY = 0.13; fx.titleSize = 70; fx.titleColor = '#ffd34d';
          if (i <= 1) { camera.position.set(0.0, 0.75, 2.8); camera.lookAt(0.0, 0.4, -0.6); }
          else { camera.position.set(0.55, 1.35, 2.9); camera.lookAt(0.15, 0.95, -0.8); }
        };
      },
    },
    { // day 3: camera cuts out
      vo: 'Day three. | The camera cuts out for a second. | Probably just the ash.',
      sfx: [{ type: 'glitch', chunk: 1, at: 0.3 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx); const C = ctx.chunks;
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 2));
        return (t, p) => {
          s.setLight(t); s.tick(t); const g0 = (C[1] ?? 1) + 0.3, dead = t > g0 && t < g0 + 0.9;
          s.feed.draw((g, W, H) => { if (dead) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = '700 30px monospace'; g.fillText('NO SIGNAL', W / 2 - 80, H / 2); } else drawFeed(g, W, H, 3, t, t > g0 - 0.2 && t < g0 + 1.2 ? 0.7 : 0); });
          camera.position.set(lib.lerp(0.95, 0.85, p), 1.2, lib.lerp(-1.9, -2.15, p)); camera.lookAt(0.75, 1.1, -2.8);
          fx.title = 'DAY 3'; fx.titleY = 0.12; if (dead) fx.glitch = 0.3;
        };
      },
    },
    { // day 5: something in the vent
      vo: "Day five. | You hear something moving in the air vent. | Slow, heavy steps. | You tell yourself it's nothing.",
      silence: true, pause: 0.55,
      sfx: [{ type: 'thuds', chunk: 1, at: 0.6, length: 4.2 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx); const C = ctx.chunks;
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 4));
        const dust = lib.particles(120, { color: '#cfc6b0', size: 0.02, spread: 0.18, seed: 4, additive: false }); dust.points.position.set(-1.15, 1.95, -2.85); ctx.scene.add(dust.points);
        return (t, p) => {
          s.setLight(t, t > (C[1] ?? 1) ? 0.25 : 0);
          const st = (C[1] ?? 1) + 0.6, step = t > st ? Math.floor((t - st) / 0.85) : -1, since = t > st ? (t - st) % 0.85 : 9;
          s.fan.rotation.z = t > st ? 0.3 * Math.sin(step) : t * 6; // fan stops, twitches with each step
          for (let i = 0; i < dust.base.length; i += 3) { const fall = t > st ? ((t - st) * 0.25 + (i % 7) * 0.05) % 0.9 : 0; dust.pos[i] = dust.base[i]; dust.pos[i + 1] = dust.base[i + 1] - fall; dust.pos[i + 2] = dust.base[i + 2] * 0.3; } dust.update(); dust.points.visible = t > st;
          s.you.position.set(1.0, 0, -1.7); s.you.rotation.y = -Math.PI / 2 - 0.4; lib.idle(s.you, t); s.you.parts.head.rotation.x = -lib.easeRange(t, st, st + 0.6) * 0.5;
          camera.position.set(lib.lerp(0.9, 0.5, p), 1.55, lib.lerp(1.2, 0.6, p)); camera.lookAt(-1.0, 1.9, -2.9);
          if (since < 0.15) lib.shake(camera, 0.015, t);
          fx.title = 'DAY 5'; fx.titleY = 0.12; fx.vignette = 0.7;
        };
      },
    },
    { // day 8: the panels go dark
      vo: 'Day eight. | The solar battery stops charging. | Like something is standing over the panels. | An hour later, it comes back.',
      pause: 0.5,
      sfx: [{ type: 'hit', chunk: 1, gain: 0.4 }, { type: 'ding', chunk: 3, gain: 0.4 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx); const C = ctx.chunks;
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 7));
        const off3 = [3000, 0, 0]; lib.topDownLights; const yard = suburbAbove(ctx, { ash: true, offset: off3 });
        const yardLight = new ctx.THREE.HemisphereLight('#d8d6d0', '#4a4844', 0); ctx.scene.add(yardLight);
        const panels = []; for (let i = 0; i < 3; i++) { const pnl = new ctx.THREE.Mesh(new ctx.THREE.BoxGeometry(2.2, 0.2, 1.4), lib.mat('#27406b')); pnl.position.set(yard.hx - 3 + i * 2.6, 0.5, yard.hz + yard.dz * 5); pnl.rotation.x = -0.35; ctx.scene.add(pnl); panels.push(pnl); }
        const shadow = shadowFigure(ctx.THREE); shadow.position.set(yard.hx, 0.75, yard.hz + yard.dz * 2); shadow.rotation.z = 0.5; ctx.scene.add(shadow);
        const fill = new ctx.THREE.PointLight('#ffd9a0', 1.2, 3, 1.5); fill.position.set(-0.9, 1.3, -2.0); ctx.scene.add(fill);
        return (t, p) => {
          s.setLight(t); const off = t > (C[1] ?? 1) && t < (C[3] ?? 4), back = t >= (C[3] ?? 4);
          s.tick(t, off ? Math.max(0.2, 0.6 - (t - (C[1] ?? 1)) * 0.08) : back ? Math.min(1, 0.4 + (t - (C[3] ?? 4)) * 0.5) : (t * 0.8) % 1);
          s.solarLed.material.color.set(off ? (Math.sin(t * 10) > 0 ? '#ff3b1f' : '#330a05') : '#2aff6a');
          const above = t > (C[2] ?? 3) - 0.1 && t < (C[3] ?? 5);
          yardLight.intensity = above ? 1.6 : 0;
          if (above) { const k = lib.range(t, C[2] ?? 3, C[3] ?? 5); shadow.position.set(yard.hx + lib.lerp(-2, 1, k), 0.75, yard.hz + yard.dz * lib.lerp(1, 4.5, k)); camera.position.set(yard.hx, 20, yard.hz + yard.dz * 4.5); camera.up.set(0, 0, -1); camera.lookAt(yard.hx, 0, yard.hz + yard.dz * 4.2); ctx.scene.background = new ctx.THREE.Color('#5f5e5a'); }
          else { camera.up.set(0, 1, 0); camera.position.set(lib.lerp(-0.45, -0.6, p), 1.05, lib.lerp(-1.0, -1.3, p)); camera.lookAt(-1.4, 0.75, -2.85); ctx.scene.background = new ctx.THREE.Color('#000'); }
          fill.intensity = 1.2;
          fx.title = 'DAY 8'; fx.titleY = 0.08;
        };
      },
    },
    { // day 11: scratching on the hatch
      vo: 'Day eleven. | Something scratches the hatch. | Three times. | Then, nothing.',
      silence: true, pause: 0.6, hold: 0.8,
      sfx: [{ type: 'scratch', chunk: 1, at: 0.2 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx); const C = ctx.chunks;
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 10));
        const dust = lib.particles(200, { color: '#cfc6b0', size: 0.02, spread: 0.35, seed: 8, additive: false }); dust.points.position.set(-0.3, 2.45, -2.6); ctx.scene.add(dust.points);
        return (t, p) => {
          const st = (C[1] ?? 1) + 0.2, sc = [0.1, 0.9, 1.7].some((k) => t > st + k - 0.1 && t < st + k + 0.55);
          s.setLight(t, sc ? 0.5 : 0); s.leak.material.opacity = sc ? 0.2 : 0.5;
          for (let i = 0; i < dust.base.length; i += 3) { const fall = t > st ? ((t - st) * 0.5 + (i % 11) * 0.07) % 2.4 : 0; dust.pos[i] = dust.base[i]; dust.pos[i + 1] = dust.base[i + 1] - fall; dust.pos[i + 2] = dust.base[i + 2]; } dust.update(); dust.points.visible = t > st;
          s.you.position.set(-1.0, 0, -1.5); s.you.rotation.y = Math.PI + 0.5; lib.idle(s.you, t); s.you.parts.head.rotation.x = -0.6;
          camera.position.set(0.8, 1.0, -0.8); camera.lookAt(-0.35, 2.2, -2.6);
          if (sc) lib.shake(camera, 0.01, t);
          fx.title = 'DAY 11'; fx.titleY = 0.12; fx.vignette = 0.75;
        };
      },
    },
    { // 11 day 14
      vo: "Day fourteen. | It's finally quiet. | You grab the ladder.",
      sfx: [{ type: 'ding', at: 0.2, gain: 0.5 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 13, 13));
        return (t, p) => {
          s.setLight(t); s.fan.rotation.z = t * 6; s.feed.draw((g, W, H) => drawFeed(g, W, H, 14, t));
          const k = lib.ease(lib.range(t, 0.6, 2.6));
          s.you.position.set(-0.3, 0, lib.lerp(-0.6, -2.35, k)); s.you.rotation.y = Math.PI; if (k < 1) lib.walk(s.you, t, 1.2 * (1 - k)); else lib.idle(s.you, t);
          s.you.parts.armR.rotation.x = -lib.easeRange(t, 2.6, 3.2) * 2.6; s.you.parts.head.rotation.x = -lib.easeRange(t, 2.6, 3.2) * 0.4;
          s.leak.material.opacity = 0.6;
          camera.position.set(0.9, 1.3, 0.4); camera.lookAt(-0.3, 1.9, -2.8);
          fx.title = 'DAY 14'; fx.titleY = 0.12;
        };
      },
    },
    { // 12 radio crackles
      vo: 'Then, the radio crackles.',
      silence: true,
      sfx: [{ type: 'static', at: 0.9, length: 1.6 }],
      build(ctx) {
        const { camera, lib } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 13, 13));
        return (t, p) => {
          const on = t > 0.9; s.setLight(t, on ? 0.7 : 0); s.feed.draw((g, W, H) => drawFeed(g, W, H, 14, t, on ? 0.4 : 0));
          s.led.material.color.set(on && Math.sin(t * 40) > -0.3 ? '#ff3b1f' : '#331100'); s.radioGlow.material.opacity = on ? 0.7 : 0;
          s.you.position.set(-0.3, 0, -2.3); s.you.rotation.y = Math.PI - lib.easeRange(t, 1.1, 1.6) * 2.4;
          camera.position.set(lib.lerp(1.9, 1.75, p), 1.2, lib.lerp(-1.4, -1.7, p)); camera.lookAt(1.4, 0.95, -2.6);
        };
      },
    },
    { // 13 the warning
      vo: "Don't come out. | Whatever you do... don't come out. | It wasn't just a bomb.",
      voice: 'am_echo', speed: 0.95, radio: true, keepVoice: true, silence: true, hold: 1.0, pause: 0.7,
      captions: { highlight: RED },
      sfx: [{ type: 'static', at: 0, length: 0.5 }, { type: 'glitch', at: 3.6, gain: 0.6 }],
      build(ctx) {
        const { camera, lib, fx, duration } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 13, 13));
        const hs = (ctx.chunks[2] ?? duration * 0.62) - 0.45, hint = [hs, hs + 0.35];
        return (t, p) => {
          s.setLight(t, 0.4); const fig = t > hint[0] && t < hint[1] ? 1 : 0;
          s.feed.draw((g, W, H) => drawFeed(g, W, H, 14, t, fig ? 1 : 0.3, fig));
          s.led.material.color.set(Math.sin(t * 40) > -0.3 ? '#ff3b1f' : '#331100'); s.radioGlow.material.opacity = 0.6 + Math.sin(t * 30) * 0.2;
          camera.position.set(lib.lerp(1.6, 1.25, p), lib.lerp(1.15, 1.1, p), lib.lerp(-1.5, -1.95, p)); camera.lookAt(1.05, 1.0, -2.7);
          fx.vignette = 0.75; if (fig) fx.glitch = 0.5;
        };
      },
    },
    { // 14 the choice
      vo: 'So, what do you do? | A. Stay, and trust the man on the radio. | Or B. Go outside, and find Leo.',
      captions: { y: 0.86, size: 54 },
      sfx: [{ type: 'hit', at: 0.1, gain: 0.6 }],
      build(ctx) {
        const { scene, camera, lib, fx } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 13, 13));
        const A = lib.label('A: STAY & TRUST THE RADIO', { height: 0.13, bg: 'rgba(30,90,200,.92)' }); A.position.set(0.3, 0.6, -2.2); scene.add(A);
        const B = lib.label('B: GO OUT & FIND LEO', { height: 0.13, bg: 'rgba(200,40,40,.92)' }); B.position.set(0.3, 2.25, -2.2); scene.add(B);
        return (t) => {
          s.setLight(t); s.leak.material.opacity = 0.8; s.radioGlow.material.opacity = 0.5; s.led.material.color.set('#ff3b1f');
          s.feed.draw((g, W, H) => drawFeed(g, W, H, 14, t, 0.2));
          s.you.position.set(-0.9, 0, -0.6); s.you.rotation.y = Math.PI * 0.85; lib.idle(s.you, t); s.you.parts.head.rotation.y = Math.sin(t * 0.8) * 0.5;
          A.visible = t > (ctx.chunks[1] ?? 1); B.visible = t > (ctx.chunks[2] ?? 2.6);
          camera.position.set(0.3, 1.45, 1.9); camera.lookAt(0.3, 1.4, -2.8);
          fx.title = 'A OR B?'; fx.titleY = 0.09; fx.titleColor = '#ffd34d';
        };
      },
    },
    { // 15 end card
      vo: 'Comment A, or B. | Part two is coming soon.',
      hold: 1.2,
      captions: false,
      build({ THREE, scene, camera, lib, fx }) {
        scene.background = new THREE.Color('#050505');
        const a = lib.label('A', { height: 1.1, bg: 'rgba(30,90,200,.95)', font: '900 96px Inter' }); a.position.set(-0.9, 0.2, 0); scene.add(a);
        const b = lib.label('B', { height: 1.1, bg: 'rgba(200,40,40,.95)', font: '900 96px Inter' }); b.position.set(0.9, 0.2, 0); scene.add(b);
        const part = lib.label('PART 2 SOON', { height: 0.35, bg: null, color: '#cccccc' }); part.position.set(0, -1.3, 0); scene.add(part);
        camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
        return (t) => {
          const k = lib.easeOut(lib.range(t, 0, 0.4)); a.position.x = -0.9 - (1 - k) * 2; b.position.x = 0.9 + (1 - k) * 2;
          fx.title = 'COMMENT'; fx.titleY = 0.3; fx.titleColor = '#ffffff'; part.visible = t > 1.2;
        };
      },
    },
  ],
};
