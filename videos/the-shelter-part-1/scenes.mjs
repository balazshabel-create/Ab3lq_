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
    g.globalAlpha = alpha; rr(g, 30, cardY, W - 60, mode === 'message' ? 330 : 150, 34, 'rgba(255,255,255,0.14)');
    g.textAlign = 'left'; g.fillStyle = '#ff5a5a'; g.font = '800 42px Inter'; g.fillText('UNKNOWN', 64, cardY + 60);
    g.fillStyle = '#9aa8c8'; g.font = '500 28px Inter'; g.textAlign = 'right'; g.fillText('now', W - 64, cardY + 56); g.textAlign = 'left';
    g.fillStyle = '#ffffff'; g.font = '800 54px Inter';
    const msg = mode === 'lock' ? 'New message' : 'They lied. Missiles inbound. Get underground. NOW.';
    const shown = mode === 'message' ? msg.slice(0, Math.ceil(msg.length * k)) : msg;
    wrap(g, shown, 64, cardY + 130, W - 128, 66); g.globalAlpha = 1;
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
  add(new THREE.BoxGeometry(0.85, 0.35, 1.9), '#4a5a3a', 1.55, 0.3, 0.6); add(new THREE.BoxGeometry(0.8, 0.1, 1.85), '#7d8f62', 1.55, 0.52, 0.6);
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
  const cal = screen(THREE, 0.7, 0.5, 512); cal.mesh.position.set(1.98, 1.65, -1.0); cal.mesh.rotation.y = -Math.PI / 2; scene.add(cal.mesh);
  // bulb
  const cord = new THREE.Group(); cord.position.set(0, 2.6, -0.6); scene.add(cord);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35), lib.mat('#111')); wire.position.y = -0.17; cord.add(wire);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff1c9' })); bulb.position.y = -0.38; cord.add(bulb);
  const light = new THREE.PointLight('#ffd08a', 4, 0, 1.2); light.position.y = -0.4; light.castShadow = true; light.shadow.mapSize.set(512, 512); cord.add(light);
  scene.add(new THREE.AmbientLight('#3a3530', 0.35));
  const you = lib.person({ shirt: '#5a7bbf', pants: '#2b3a55' }); scene.add(you);
  /** flicker 0..1 amount, swing radians */
  const setLight = (t, flicker = 0, swing = 0) => { const f = 1 - flicker * (Math.sin(t * 53) > 0.6 ? 0.8 : 0) * (Math.sin(t * 7.1) > 0 ? 1 : 0.3); light.intensity = 4 * f; bulb.material.color.setScalar(0.35 + 0.65 * f); cord.rotation.z = swing; cord.rotation.x = swing * 0.4; };
  return { you, feed, cal, radio, led, radioGlow, fan, solarLed, leak, light, setLight };
}

const RED = '#ff5a5a';

export default {
  // voice comes from the skill default (American male blend) unless set here
  voice: 'am_michael:0.5,am_fenrir:0.3,am_puck:0.2',
  speed: 1.15,
  music: { style: 'tense', volume: 0.15 },
  scenes: [
    { // 1 hook
      vo: 'Imagine you wake up at midnight when your phone buzzes.',
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
      vo: "It's a message from an unknown number. They lied. Missiles are coming. Get underground.",
      sfx: [{ type: 'heartbeat', at: 1.5 }, { type: 'heartbeat', at: 2.6 }, { type: 'heartbeat', at: 3.6 }],
      build({ THREE, scene, camera, lib, fx }) {
        scene.background = new THREE.Color('#05070d');
        const ph = phoneModel(THREE, lib); scene.add(ph.group); scene.add(new THREE.AmbientLight('#fff', 0.5));
        const halo = lib.glow('#5f8cff', 3.5, 0.35); halo.position.z = -0.3; scene.add(halo);
        camera.position.set(0, 0, 2.3); camera.lookAt(0, 0, 0);
        return (t, p) => {
          ph.screen.draw((g, W, H) => drawPhone(g, W, H, 'message', t, lib.range(t, 0.8, 4.2)));
          ph.group.rotation.set(-0.08 + Math.sin(t * 1.3) * 0.02, 0.12 - p * 0.1, 0.02);
          camera.position.z = 2.3 - p * 0.35; fx.vignette = 0.7;
        };
      },
    },
    { // 3 the news lies
      vo: "You turn on the news. Nothing. They're saying everything is fine.",
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
    { // 4 Leo doesn't answer
      vo: 'You call your best friend, Leo. Once. Twice. No answer.',
      sfx: [{ type: 'ding', at: 0.5, gain: 0.4 }, { type: 'ding', at: 1.9, gain: 0.4 }, { type: 'hit', at: 2.5, gain: 0.5 }],
      minDuration: 3.8,
      build({ THREE, scene, camera, lib, fx }) {
        scene.background = new THREE.Color('#05070d');
        const ph = phoneModel(THREE, lib); scene.add(ph.group); scene.add(new THREE.AmbientLight('#fff', 0.5));
        const halo = lib.glow('#5f8cff', 3.5, 0.3); halo.position.z = -0.3; scene.add(halo);
        camera.position.set(0, 0, 2.2); camera.lookAt(0, 0, 0);
        return (t, p) => {
          const fail = t > 2.5; ph.screen.draw((g, W, H) => drawPhone(g, W, H, fail ? 'noanswer' : 'calling', t));
          halo.material.color.set(fail ? '#ff4d4d' : '#5f8cff');
          ph.group.rotation.set(-0.05, -0.1 + p * 0.15, -0.03); camera.position.z = 2.2 - p * 0.25; fx.vignette = 0.7;
          if (fail && t < 2.8) lib.shake(camera, 0.02, t);
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
          s.you.position.set(x, 0, z); s.you.rotation.y = Math.atan2(8, -2.6) ; lib.walk(s.you, t, 1.9); s.you.parts.torso.rotation.x = 0.2;
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
          s.you.position.set(1.0, 0, 0.3); s.you.rotation.y = Math.PI + Math.sin(t * 0.9) * 0.6; lib.idle(s.you, t);
          s.fan.rotation.z = t * 6;
          camera.position.set(-0.3, 1.7, 2.7); camera.lookAt(lib.lerp(-0.8, 0.4, lib.ease(p)), 1.2, -2.5);
          fx.fade = Math.max(0, 1 - t * 0.9);
        };
      },
    },
    { // 8 inventory
      vo: 'Water. Food. Good airflow. A camera to see outside. And solar panels that only work when the sun is up.',
      sfx: [{ type: 'pop', at: 0.15 }, { type: 'pop', at: 1.0 }, { type: 'pop', at: 1.8 }, { type: 'pop', at: 3.0 }, { type: 'pop', at: 4.4 }],
      build(ctx) {
        const { THREE, scene, camera, lib } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 0)); s.you.position.set(1.5, 0, 1.6); s.you.rotation.y = Math.PI;
        const items = [
          ['WATER', [-1.75, 0.48, -1.3], 0.15], ['FOOD', [-1.75, 1.15, -1.3], 1.0], ['AIR VENT', [-1.15, 2.05, -2.9], 1.8],
          ['CAMERA', [0.75, 1.1, -2.75], 3.0], ['SOLAR POWER', [-1.15, 1.2, -2.9], 4.4],
        ].map(([txt, pos, at]) => { const l = lib.label(txt, { height: 0.2, bg: 'rgba(20,20,20,.85)', color: '#ffd34d' }); l.position.set(pos[0] + (pos[2] < -2.5 ? 0.05 : 0.45), pos[1] + 0.22, pos[2] + 0.2); l.visible = false; scene.add(l); return { l, pos: new THREE.Vector3(...pos), at }; });
        const look = new THREE.Vector3();
        return (t) => {
          s.setLight(t); s.fan.rotation.z = t * 6; s.feed.draw((g, W, H) => drawFeed(g, W, H, 1, t));
          let cur = 0; items.forEach((it, i) => { const shown = t >= it.at; it.l.visible = shown; if (shown) cur = i; const pop = lib.easeOut(lib.range(t, it.at, it.at + 0.15)); const sc = it.l.userData.base ??= it.l.scale.clone(); it.l.scale.copy(sc).multiplyScalar(0.6 + 0.4 * pop); });
          const a = items[cur].pos, b = items[Math.min(cur, items.length - 1)].pos;
          look.lerpVectors(a, b, 1);
          const tgt = camera.userData.tgt ??= look.clone(); tgt.lerp(look, 0.12);
          camera.position.set(tgt.x * 0.4 + 0.9, 1.55, tgt.z + 3.4); camera.lookAt(tgt);
        };
      },
    },
    { // 9 the plan
      vo: 'You make a plan. Two weeks underground, until the radiation outside gets weak enough.',
      sfx: [{ type: 'ding', at: 1.4, gain: 0.5 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx);
        return (t, p) => {
          s.setLight(t); s.cal.draw((g, W, H) => drawCalendar(g, W, H, 0, t > 1.4 ? 0 : -1));
          s.you.position.set(0.9, 0, -2.2); s.you.rotation.y = Math.PI / 2; lib.idle(s.you, t);
          camera.position.set(lib.lerp(0.2, 0.5, p), 1.6, lib.lerp(0.6, 0.0, p)); camera.lookAt(1.98, 1.6, -1.0);
          if (t > 1.4) { fx.title = 'DAY 1 / 14'; fx.titleY = 0.15; fx.titleColor = '#ffffff'; }
        };
      },
    },
    { // 10 routine montage
      vo: 'Every day, the same routine. Ration the food. Check the camera. Charge the batteries while the sun is up.',
      sfx: [{ type: 'whoosh', at: 0.1, gain: 0.5 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = shelter(ctx);
        const spots = [[-1.1, -1.3, -Math.PI / 2], [0.75, -2.0, Math.PI], [1.4, 0.6, Math.PI / 2]];
        return (t, p) => {
          const dayF = 1 + p * 12.99, day = Math.floor(dayF), phase = Math.floor((dayF - day) * 3);
          s.setLight(t); s.fan.rotation.z = t * 6;
          s.cal.draw((g, W, H) => drawCalendar(g, W, H, day - 1));
          s.feed.draw((g, W, H) => drawFeed(g, W, H, day, t));
          const sp = spots[phase]; s.you.position.set(sp[0], 0, sp[1]); s.you.rotation.y = sp[2]; lib.idle(s.you, t);
          s.you.parts.armR.rotation.x = phase === 0 ? -1.2 : phase === 1 ? -0.6 : 0;
          s.solarLed.material.color.set(phase === 2 ? '#ffd34d' : (dayF % 1) < 0.5 ? '#2aff6a' : '#103a1a');
          camera.position.set(0.3, 2.1, 2.6); camera.lookAt(0, 1.0, -1.2);
          fx.title = `DAY ${day}`; fx.titleY = 0.12; fx.titleSize = 90;
        };
      },
    },
    { // 11 day 14
      vo: 'Day fourteen. Everything seems fine. You grab the ladder.',
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
      vo: "Don't come out. Whatever you do, don't come out. It wasn't just a bomb.",
      voice: 'am_onyx', speed: 0.95, radio: true, silence: true, hold: 0.9,
      captions: { highlight: RED },
      sfx: [{ type: 'static', at: 0, length: 0.5 }, { type: 'glitch', at: 3.6, gain: 0.6 }],
      build(ctx) {
        const { camera, lib, fx, duration } = ctx; const s = shelter(ctx);
        s.cal.draw((g, W, H) => drawCalendar(g, W, H, 13, 13));
        const hint = [duration * 0.62, duration * 0.62 + 0.35];
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
      vo: 'So what do you do? A: stay, and trust the man on the radio. Or B: go out and find Leo.',
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
          A.visible = t > 1.0; B.visible = t > 2.6;
          camera.position.set(0.3, 1.45, 1.9); camera.lookAt(0.3, 1.4, -2.8);
          fx.title = 'A OR B?'; fx.titleY = 0.09; fx.titleColor = '#ffd34d';
        };
      },
    },
    { // 15 end card
      vo: 'Comment A or B. Part two is coming.',
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
