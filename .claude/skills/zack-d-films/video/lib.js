// Helper library for zack-d-films scenes. Every scene's build(ctx) receives this as ctx.lib.
import * as THREE from 'three';

// ---------- math ----------
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => Math.pow(clamp(t), 3);
/** 0..1 progress of t inside [a, b] (seconds or 0..1 progress, whatever you pass). */
export const range = (t, a, b) => clamp((t - a) / (b - a));
export const easeRange = (t, a, b) => ease(range(t, a, b));
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- style ----------
/** '3d' (default, realistic-ish lighting) or 'ink' (hand-drawn look: toon shading + black outlines + stick figures). */
let STYLE = '3d';
export const setStyle = (s) => { STYLE = s || '3d'; };
export const getStyle = () => STYLE;
let _grad;
function toonGrad() {
  if (_grad) return _grad;
  const d = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 225, 225, 225, 255, 255, 255, 255, 255]);
  _grad = new THREE.DataTexture(d, 4, 1); _grad.minFilter = _grad.magFilter = THREE.NearestFilter; _grad.needsUpdate = true; return _grad;
}
const noOutline = (m) => { m.userData.outlineParameters = { visible: false }; return m; };
export { noOutline };

// ---------- materials ----------
export const mat = (color, o = {}) => {
  if (STYLE === 'ink') { const { roughness, metalness, flatShading, ...rest } = o; return new THREE.MeshToonMaterial({ color, gradientMap: toonGrad(), ...rest }); }
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, ...o });
};
export const glowMat = (color, o = {}) => noOutline(new THREE.MeshBasicMaterial({ color, ...o }));
function shadow(obj) { obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return obj; }
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ---------- environments ----------
/** Daytime/outdoor environment: gradient sky dome, hemisphere light, shadow-casting sun, fog. */
export function sky(scene, { top = '#2f74d0', bottom = '#cfe6ff', sun = true, sunColor = '#fff1d6', sunIntensity = 2.4, sunPos = [25, 40, 18], fog = true, fogNear = 40, fogFar = 450, ambient = 0.7 } = {}) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.12,0.,1.); gl_FragColor = vec4(mix(bottom, top, pow(h,0.75)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
  });
  noOutline(m); const dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), m); dome.renderOrder = -1; scene.add(dome);
  if (fog) scene.fog = new THREE.Fog(new THREE.Color(bottom), fogNear, fogFar);
  const hemi = new THREE.HemisphereLight(top, '#5c4b3a', ambient); scene.add(hemi);
  let light = null;
  if (sun) {
    light = new THREE.DirectionalLight(sunColor, sunIntensity); light.position.set(...sunPos);
    light.castShadow = true; light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 160 });
    light.shadow.bias = -0.0004; light.shadow.normalBias = 0.02; scene.add(light); scene.add(light.target);
  }
  return { dome, hemi, light, setColors(t, b) { m.uniforms.top.value.set(t); m.uniforms.bottom.value.set(b); scene.fog?.color.set(b); hemi.color.set(t); } };
}

/** Outer space: dark background, starfield, soft fill + key light. */
export function space(scene, { background = '#02030a', stars = 4000, seed = 7, key = '#ffffff', keyPos = [10, 6, 8], keyIntensity = 3, fill = 0.25 } = {}) {
  scene.background = new THREE.Color(background);
  const r = rng(seed), pos = new Float32Array(stars * 3), col = new Float32Array(stars * 3);
  for (let i = 0; i < stars; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 900 + r() * 600;
    pos.set([R * s * Math.cos(th), R * u, R * s * Math.sin(th)], i * 3);
    const c = new THREE.Color().setHSL(0.55 + r() * 0.15, 0.4, 0.6 + r() * 0.4); col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, map: dotTexture(), transparent: true, depthWrite: false, fog: false }));
  scene.add(starPts);
  scene.add(new THREE.AmbientLight('#8899ff', fill));
  const light = new THREE.DirectionalLight(key, keyIntensity); light.position.set(...keyPos); scene.add(light);
  return { stars: starPts, light };
}

export function ground(scene, { color = '#5f9e46', size = 600, y = 0, roughness = 1 } = {}) {
  const tex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = color; c.fillRect(0, 0, w, h); const r = rng(3);
    for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.05})`; c.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4); }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(size / 8, size / 8);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat('#ffffff', { map: tex, roughness }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; scene.add(m); return m;
}

// ---------- characters & props ----------
/**
 * Stylized person, ~1.9 units tall, feet at y=0, facing +z.
 * parts: head, torso, armL, armR (pivot at shoulder), legL, legR (pivot at hip), mouth, eyes, hair.
 */
export function person(opts = {}) { return STYLE === 'ink' ? stickman(opts) : person3d(opts); }
/**
 * Hand-drawn style stick figure (same rig/parts as person(), so all pose helpers work):
 * big round white head with dot eyes, beanie, scarf, thin black limbs.
 */
export function stickman({ hat = '#d39a2c', scarf = '#5b5f66', head = '#f7f5ef', limb = '#151515', hatOn = true } = {}) {
  const g = new THREE.Group(), P = {};
  const ink = mat(limb), r = 0.035;
  P.torso = new THREE.Mesh(new THREE.CapsuleGeometry(r * 1.3, 0.55, 4, 10), ink); P.torso.position.y = 1.18; g.add(P.torso);
  P.head = new THREE.Group(); P.head.position.y = 1.78; g.add(P.head);
  P.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), mat(head)));
  P.eyes = [-0.09, 0.09].map((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), glowMat('#111')); e.scale.set(0.8, 1.25, 0.5); e.position.set(x, 0.0, 0.285); P.head.add(e); return e; });
  P.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), glowMat('#222')); P.mouth.scale.set(1.2, 0.25, 0.4); P.mouth.position.set(0, -0.12, 0.28); P.head.add(P.mouth);
  if (hatOn) {
    P.hair = new THREE.Mesh(new THREE.SphereGeometry(0.315, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(hat)); P.hair.position.y = 0.035; P.hair.rotation.x = -0.12; P.head.add(P.hair);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.045, 10, 32), mat(hat)); rim.rotation.x = Math.PI / 2 - 0.12; rim.position.set(0, 0.12, -0.012); P.head.add(rim);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), mat(hat)); pom.position.set(0, 0.34, -0.04); P.head.add(pom);
  }
  const sc = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.05, 10, 24), mat(scarf)); sc.rotation.x = Math.PI / 2; sc.position.y = 1.47; g.add(sc);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.04), mat(scarf)); tail.position.set(0.06, 1.33, 0.08); tail.rotation.z = 0.15; g.add(tail);
  const limbFn = (len, x, y, foot) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), ink); m.position.y = -len / 2 - r; pivot.add(m);
    const end = new THREE.Mesh(foot ? new THREE.BoxGeometry(0.1, 0.05, 0.18) : new THREE.SphereGeometry(0.05, 10, 8), ink); end.position.set(0, -len - r * 2, foot ? 0.05 : 0); pivot.add(end);
    g.add(pivot); return pivot;
  };
  P.armL = limbFn(0.6, -0.06, 1.42); P.armR = limbFn(0.6, 0.06, 1.42);
  P.legL = limbFn(0.78, -0.06, 0.9, true); P.legR = limbFn(0.78, 0.06, 0.9, true);
  P.armL.rotation.z = -0.12; P.armR.rotation.z = 0.12;
  g.userData.parts = P; g.parts = P; g.isStick = true; shadow(g); g.traverse((m) => { if (m.isMesh) m.receiveShadow = false; }); return g;
}
function person3d({ skin = '#f0c08a', shirt = '#e94b3c', pants = '#2b3a55', hair = '#3a2414', shoes = '#222' } = {}) {
  const g = new THREE.Group(), P = {};
  P.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.45, 6, 16), mat(shirt)); P.torso.position.y = 1.2; g.add(P.torso);
  P.head = new THREE.Group(); P.head.position.y = 1.74; g.add(P.head);
  P.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 24), mat(skin)));
  P.hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(hair, { roughness: 0.9 }));
  P.hair.position.set(0, 0.03, -0.02); P.hair.rotation.x = -0.25; P.head.add(P.hair);
  P.eyes = [-0.08, 0.08].map((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), glowMat('#111')); e.position.set(x, 0.03, 0.215); P.head.add(e); return e; });
  P.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 8), glowMat('#5a1f1f')); P.mouth.scale.set(1.2, 0.25, 0.4); P.mouth.position.set(0, -0.09, 0.21); P.head.add(P.mouth);
  const limb = (r, len, color, x, y, foot) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat(color)); m.position.y = -len / 2 - r * 0.6; pivot.add(m);
    if (foot) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.26), mat(shoes)); f.position.set(0, -len - r * 1.4, 0.05); pivot.add(f); }
    else { const hnd = new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 12, 8), mat(skin)); hnd.position.y = -len - r * 1.2; pivot.add(hnd); }
    g.add(pivot); return pivot;
  };
  P.armL = limb(0.075, 0.5, shirt, -0.36, 1.48); P.armR = limb(0.075, 0.5, shirt, 0.36, 1.48);
  P.legL = limb(0.1, 0.58, pants, -0.13, 0.86, true); P.legR = limb(0.1, 0.58, pants, 0.13, 0.86, true);
  P.armL.rotation.z = -0.08; P.armR.rotation.z = 0.08;
  g.userData.parts = P; g.parts = P; return shadow(g);
}
/** Pose helpers (pure functions of t, safe to call every frame). */
export function idle(p, t) { const P = p.parts; P.torso.scale.y = 1 + Math.sin(t * 2) * 0.01; P.head.rotation.z = Math.sin(t * 0.7) * 0.03; P.armL.rotation.x = P.armR.rotation.x = Math.sin(t * 2) * 0.03; P.legL.rotation.x = P.legR.rotation.x = 0; }
export function walk(p, t, speed = 1) { const P = p.parts, s = Math.sin(t * 6 * speed) * 0.55; P.legL.rotation.x = s; P.legR.rotation.x = -s; P.armL.rotation.x = -s * 0.8; P.armR.rotation.x = s * 0.8; P.torso.position.y = 1.2 + Math.abs(Math.cos(t * 6 * speed)) * 0.03; }
export function wave(p, t) { const P = p.parts; P.armR.rotation.z = 2.6; P.armR.rotation.x = 0; P.armR.rotation.y = Math.sin(t * 8) * 0.4; }
/** mouth 0 = closed, 1 = screaming. */
export function mouth(p, open) { p.parts.mouth.scale.set(1.2 - open * 0.3, 0.25 + open * 1.4, 0.4); }
/** Character in a chair eating from a bowl (returns {group, spoon}). Animate spoon with eat(). */
export function bowl() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#f4f4f4', { side: THREE.DoubleSide })); g.add(b);
  const milk = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), mat('#fff8e6')); milk.rotation.x = -Math.PI / 2; milk.position.y = -0.03; g.add(milk);
  const r = rng(5); for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.009, 6, 10), mat(['#f2b134', '#e05a2a', '#7bc043'][i % 3])); c.position.set((r() - 0.5) * 0.2, -0.02, (r() - 0.5) * 0.2); c.rotation.x = -Math.PI / 2 + r(); g.add(c); }
  return shadow(g);
}

export function tree({ height = 4, color = '#3f8f3a', trunk = '#6b4a2b', seed = 1 } = {}) {
  const g = new THREE.Group(), r = rng(seed);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * height / 4, 0.18 * height / 4, height * 0.45, 8), mat(trunk)); t.position.y = height * 0.225; g.add(t);
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(height * (0.22 + r() * 0.1), 1), mat(color, { flatShading: true })); s.position.set((r() - 0.5) * height * 0.3, height * (0.55 + r() * 0.25), (r() - 0.5) * height * 0.3); g.add(s); }
  return shadow(g);
}

export function house({ color = '#e8dcc8', roof = '#9c3b2f', w = 4, d = 4, h = 2.6 } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); body.position.y = h / 2; g.add(body);
  const rf = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 * 1.05, h * 0.6, 4), mat(roof)); rf.position.y = h + h * 0.3; rf.rotation.y = Math.PI / 4; g.add(rf);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.05), mat('#5b3a22')); door.position.set(0, 0.8, d / 2 + 0.02); g.add(door);
  [-1.2, 1.2].forEach((x) => { const wnd = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.05), mat('#9fd3ff', { emissive: '#335577', emissiveIntensity: 0.3 })); wnd.position.set(x, 1.6, d / 2 + 0.02); g.add(wnd); });
  return shadow(g);
}

/** Skyscraper city spread around a center. Returns group; group.children are buildings. */
export function city(scene, { count = 70, radius = 70, minR = 10, seed = 2, center = [0, 0, 0], night = false } = {}) {
  const g = new THREE.Group(), r = rng(seed);
  const win = canvasTex(64, 128, (c, w, h) => { c.fillStyle = night ? '#111522' : '#5d6b80'; c.fillRect(0, 0, w, h); for (let y = 4; y < h; y += 10) for (let x = 4; x < w; x += 12) { c.fillStyle = night ? (Math.random() < 0.55 ? '#ffd27a' : '#1b2233') : (Math.random() < 0.5 ? '#bcd6f0' : '#8aa3bd'); c.fillRect(x, y, 7, 6); } });
  win.wrapS = win.wrapT = THREE.RepeatWrapping;
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = minR + Math.sqrt(r()) * (radius - minR), w = 3 + r() * 5, h = 6 + Math.pow(r(), 2) * 40;
    const t = win.clone(); t.repeat.set(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 6))); t.needsUpdate = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat('#ffffff', { map: t, emissiveMap: night ? t : null, emissive: night ? '#ffffff' : '#000', emissiveIntensity: night ? 0.8 : 0, roughness: 0.5 }));
    b.position.set(center[0] + Math.cos(a) * d, h / 2, center[2] + Math.sin(a) * d); g.add(b);
  }
  scene.add(g); return shadow(g);
}

// ---------- space objects ----------
function noise2(seed) { const r = rng(seed), N = 256, p = Array.from({ length: N }, () => r()); const v = (x, y) => p[((x & 255) * 31 + (y & 255) * 57) % N]; return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = (t) => t * t * (3 - 2 * t); return lerp(lerp(v(xi, yi), v(xi + 1, yi), s(xf)), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), s(xf)), s(yf)); }; }
function fbm(n, x, y) { let a = 0, f = 1, amp = 0.5; for (let i = 0; i < 5; i++) { a += n(x * f, y * f) * amp; f *= 2; amp *= 0.5; } return a; }
/** kind: 'earth' | 'moon' | 'mars' | 'gas' | 'ice' | 'lava'. Returns group with .surface and .atmo meshes. */
export function planet({ radius = 1, kind = 'earth', seed = 4, atmosphere } = {}) {
  const n = noise2(seed), r = rng(seed);
  const tex = canvasTex(512, 256, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = fbm(n, x / 48, y / 48), lat = Math.abs(y / h - 0.5) * 2; let col;
      if (kind === 'earth') col = lat > 0.86 ? [235, 240, 245] : v > 0.52 ? (v > 0.62 ? [120, 105, 70] : [62, 125, 58]) : [22, 70, 150 + v * 60];
      else if (kind === 'moon') col = [130 + v * 90, 130 + v * 90, 128 + v * 88];
      else if (kind === 'mars') col = [170 + v * 70, 80 + v * 40, 45 + v * 20];
      else if (kind === 'gas') { const b = Math.sin(y / h * 22 + v * 4); col = [200 + b * 30, 160 + b * 40, 110 + b * 30]; }
      else if (kind === 'ice') col = [190 + v * 60, 220 + v * 35, 245];
      else col = v > 0.55 ? [255, 120 + v * 100, 20] : [40 + v * 30, 20, 15];
      const i = (y * w + x) * 4; img.data.set([...col, 255], i);
    }
    c.putImageData(img, 0, 0);
    if (kind === 'moon') for (let i = 0; i < 60; i++) { const x = r() * w, y = r() * h, s = 2 + r() * 12; c.strokeStyle = 'rgba(60,60,60,.5)'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, s, 0, 7); c.stroke(); c.fillStyle = 'rgba(40,40,40,.25)'; c.fill(); }
  });
  const g = new THREE.Group();
  g.surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), mat('#ffffff', { map: tex, roughness: 0.9, emissive: kind === 'lava' ? '#ff5500' : '#000', emissiveIntensity: kind === 'lava' ? 0.4 : 0 }));
  g.add(g.surface);
  if (kind === 'earth') {
    const cl = canvasTex(512, 256, (c, w, h) => { const n2 = noise2(seed + 9), img = c.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fbm(n2, x / 40, y / 30); img.data.set([255, 255, 255, v > 0.55 ? (v - 0.55) * 900 : 0], (y * w + x) * 4); } c.putImageData(img, 0, 0); });
    g.clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.01, 64, 48), new THREE.MeshStandardMaterial({ map: cl, transparent: true, depthWrite: false })); g.add(g.clouds);
  }
  const atmoColor = atmosphere ?? { earth: '#5fa8ff', mars: '#ffaa77', ice: '#bfe8ff', gas: '#ffd9a0' }[kind];
  if (atmoColor) { g.atmo = fresnelSphere(radius * 1.06, atmoColor, { power: 3, intensity: 1.3 }); g.add(g.atmo); }
  return g;
}
/** Glowing star/sun: emissive sphere + additive halo sprite. */
export function star({ radius = 2, color = '#ffcc55' } = {}) {
  const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), glowMat(color)));
  const halo = glow(color, radius * 7); g.add(halo); const light = new THREE.PointLight(color, 4, 0, 0); g.add(light); g.light = light; return g;
}
/** Rim-lit transparent sphere (atmospheres, soap-bubble universes, force fields). */
export function fresnelSphere(radius, color, { power = 2.5, intensity = 1, opacity = 1, iridescent = false } = {}) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { c: { value: new THREE.Color(color) }, p: { value: power }, k: { value: intensity }, o: { value: opacity }, ir: { value: iridescent ? 1 : 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; uniform float p,k,o,ir; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-max(dot(vN,vV),0.),p); vec3 col = c; if(ir>0.5){ col = mix(c, 0.5+0.5*cos(6.28*(f*1.5+vec3(0.,.33,.67))), .6);} gl_FragColor = vec4(col*f*k*o, 1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
  });
  noOutline(m); return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), m);
}
/** A "bubble universe": iridescent shell with a tiny galaxy-dust interior. */
export function bubble({ radius = 3, color = '#88ccff', seed = 1, dust = 600 } = {}) {
  const g = new THREE.Group(); g.add(fresnelSphere(radius, color, { power: 2, intensity: 1.6, iridescent: true }));
  if (dust) { const p = particles(dust, { color, size: 0.015 * radius, spread: radius * 0.8, seed, shape: 'ball' }); g.add(p.points); g.dust = p; }
  return g;
}

// ---------- particles, glows, labels ----------
let _dot; function dotTexture() { return (_dot ??= canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); })); }
/** shape: 'box' | 'ball' | 'disc'. Returns {points, base (Float32Array of start positions), pos (live attribute array), update()}. */
export function particles(count, { color = '#ffffff', size = 0.1, spread = 5, seed = 1, shape = 'box', additive = true, opacity = 1 } = {}) {
  const r = rng(seed), base = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let x, y, z;
    if (shape === 'ball') { do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1); }
    else if (shape === 'disc') { const a = r() * Math.PI * 2, d = Math.sqrt(r()); x = Math.cos(a) * d; y = (r() - 0.5) * 0.08; z = Math.sin(a) * d; }
    else { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; }
    base.set([x * spread, y * spread, z * spread], i * 3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map: dotTexture(), transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  const pos = geo.attributes.position.array;
  return { points, base, pos, update() { geo.attributes.position.needsUpdate = true; } };
}
/** Soft additive glow sprite. */
export function glow(color = '#ffffff', size = 2, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.scale.set(size, size, 1); return s;
}
/** Text label sprite in world space. height = world units tall. */
export function label(text, { color = '#ffffff', bg = 'rgba(0,0,0,0.55)', height = 0.6, font = '800 72px Inter' } = {}) {
  const c = document.createElement('canvas'), x = c.getContext('2d'); x.font = font; const w = Math.ceil(x.measureText(text).width) + 60;
  c.width = w; c.height = 110; x.font = font; if (bg) { x.fillStyle = bg; x.beginPath(); x.roundRect(0, 0, w, 110, 30); x.fill(); }
  x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, 58);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false })); s.scale.set(height * w / 110, height, 1); s.renderOrder = 10; return s;
}
/** A flat glowing "wall" plane (e.g. the edge of another universe). */
export function wall({ width = 400, height = 300, color = '#b48cff', additive = true, strength = 0.7 } = {}) {
  const m = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { c: { value: new THREE.Color(color) }, time: { value: 0 }, k: { value: strength } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 c; uniform float time; uniform float k; varying vec2 vU; float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);} void main(){ float n = h(floor(vU*vec2(160.,120.)) + floor(time*12.)); float lines = 0.5+0.5*sin(vU.y*300.+time*20.); float a = 0.35 + 0.35*n + 0.3*lines; gl_FragColor = vec4(c*a*k, clamp(a*k,0.,1.));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
  });
  noOutline(m); const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m); mesh.setTime = (t) => { m.uniforms.time.value = t; }; return mesh;
}

// ---------- camera ----------
/** Place camera on an orbit around target. angle in radians, height in units. */
export function orbit(camera, { target = [0, 1, 0], radius = 6, angle = 0, height = 1.6 } = {}) {
  camera.position.set(target[0] + Math.sin(angle) * radius, height, target[2] + Math.cos(angle) * radius); camera.lookAt(...target);
}
/** Add deterministic shake AFTER you set the camera for the frame. */
export function shake(camera, amount, t) { camera.position.x += Math.sin(t * 61.3) * amount; camera.position.y += Math.sin(t * 47.9 + 1) * amount; camera.rotation.z += Math.sin(t * 33.1) * amount * 0.05; }

// ---------- 2D post effects (set fields on ctx.fx inside update) ----------
export function makeFx() { return { paper: 0, flash: 0, fade: 0, vignette: 0.45, crack: 0, crackX: 0.5, crackY: 0.3, crackSeed: 3, glitch: 0, tint: '#000000', tintAmount: 0, title: '', titleColor: '#ffffff', titleY: 0.2, titleSize: 96, xray: 0 }; }
export function resetFx(fx) { const d = makeFx(); for (const k of ['flash', 'fade', 'glitch', 'tintAmount', 'title', 'crack', 'xray']) fx[k] = d[k]; }
let _paper;
function paperPattern(o) {
  if (_paper) return _paper;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const r = rng(77);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = 100 + r() * 60; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1); }
  for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? 70 : 190},${r() < 0.5 ? 70 : 190},${r() < 0.5 ? 70 : 190},0.25)`; g.beginPath(); const x = r() * 256, y = r() * 256; g.moveTo(x, y); g.lineTo(x + 20 + r() * 40, y + (r() - 0.5) * 6); g.stroke(); }
  return (_paper = o.createPattern(c, 'repeat'));
}
export function drawFx(o, fx, W, H, time) {
  if (fx.paper > 0) { o.save(); o.globalCompositeOperation = 'overlay'; o.globalAlpha = fx.paper; o.fillStyle = paperPattern(o); o.fillRect(0, 0, W, H); o.restore(); }
  if (fx.xray > 0) { o.save(); o.globalAlpha = fx.xray; o.filter = 'invert(1) hue-rotate(180deg) saturate(0.4) brightness(1.1)'; o.drawImage(o.canvas, 0, 0); o.restore(); o.save(); o.globalAlpha = fx.xray * 0.35; o.fillStyle = '#3cf'; o.globalCompositeOperation = 'multiply'; o.fillRect(0, 0, W, H); o.restore(); }
  if (fx.tintAmount > 0) { o.save(); o.globalAlpha = fx.tintAmount; o.fillStyle = fx.tint; o.fillRect(0, 0, W, H); o.restore(); }
  if (fx.glitch > 0) {
    const r = rng(Math.floor(time * 24) + 11), n = Math.floor(4 + fx.glitch * 14);
    for (let i = 0; i < n; i++) { const y = r() * H, h = 4 + r() * 50 * fx.glitch, dx = (r() - 0.5) * 120 * fx.glitch; o.drawImage(o.canvas, 0, y, W, h, dx, y, W, h); }
    o.save(); o.globalAlpha = 0.25 * fx.glitch; o.globalCompositeOperation = 'screen'; o.fillStyle = r() < 0.5 ? '#f0f' : '#0ff'; o.fillRect(0, r() * H, W, 6 + r() * 30); o.restore();
  }
  if (fx.crack > 0) drawCrack(o, fx, W, H);
  if (fx.vignette > 0) { const g = o.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${fx.vignette})`); o.fillStyle = g; o.fillRect(0, 0, W, H); }
  if (fx.title) { o.save(); o.font = `900 ${fx.titleSize}px Inter`; o.textAlign = 'center'; o.textBaseline = 'middle'; o.lineJoin = 'round'; o.lineWidth = fx.titleSize * 0.18; o.strokeStyle = '#000'; o.strokeText(fx.title, W / 2, H * fx.titleY); o.fillStyle = fx.titleColor; o.fillText(fx.title, W / 2, H * fx.titleY); o.restore(); }
  if (fx.flash > 0) { o.save(); o.globalAlpha = clamp(fx.flash); o.fillStyle = '#fff'; o.fillRect(0, 0, W, H); o.restore(); }
  if (fx.fade > 0) { o.save(); o.globalAlpha = clamp(fx.fade); o.fillStyle = '#000'; o.fillRect(0, 0, W, H); o.restore(); }
}
function drawCrack(o, fx, W, H) {
  const r = rng(fx.crackSeed), cx = fx.crackX * W, cy = fx.crackY * H, grow = clamp(fx.crack);
  const segs = [];
  const branch = (x, y, a, len, depth) => { let px = x, py = y; const steps = 9; for (let i = 0; i < steps; i++) { a += (r() - 0.5) * 0.7; const nx = px + Math.cos(a) * len / steps, ny = py + Math.sin(a) * len / steps; segs.push([px, py, nx, ny, depth, i / steps]); if (depth < 2 && r() < 0.22) branch(nx, ny, a + (r() < 0.5 ? 0.9 : -0.9), len * 0.45, depth + 1); px = nx; py = ny; } };
  const arms = 9; for (let i = 0; i < arms; i++) branch(cx, cy, (i / arms) * Math.PI * 2 + r() * 0.5, H * (0.35 + r() * 0.45), 0);
  o.save(); o.lineCap = 'round';
  for (const pass of [0, 1]) for (const [x1, y1, x2, y2, d, f] of segs) {
    const reach = d === 0 ? f : 0.3 + f * 0.7; if (reach > grow * 1.05) continue;
    o.strokeStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.55)'; o.lineWidth = (pass ? 2.2 : 5) * (1 - d * 0.3);
    o.beginPath(); o.moveTo(x1, y1); o.lineTo(x2, y2); o.stroke();
  }
  const g = o.createRadialGradient(cx, cy, 0, cx, cy, 60 * grow); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); o.fillStyle = g; o.fillRect(cx - 80, cy - 80, 160, 160);
  o.restore();
}

// ---------- captions ----------
export function drawCaption(o, words, t, W, H, opts = {}) {
  if (!words?.length || opts === false) return;
  const { perGroup = 3, y = 0.7, size = 64, highlight = '#ffe14d', color = '#ffffff' } = opts;
  let i = -1; for (let k = 0; k < words.length; k++) if (words[k].start <= t) i = k;
  if (i < 0 || t > words[words.length - 1].end + 0.35) return;
  const g0 = Math.floor(i / perGroup) * perGroup, group = words.slice(g0, g0 + perGroup);
  let fs = size; o.save(); o.textBaseline = 'middle'; o.lineJoin = 'round';
  const measure = () => { o.font = `900 ${fs}px Inter`; return group.map((w) => o.measureText(w.w.toUpperCase()).width); };
  let ws = measure(), gap = fs * 0.36, total = ws.reduce((a, b) => a + b, 0) + gap * (group.length - 1);
  while (total > W * 0.9 && fs > 30) { fs -= 4; ws = measure(); gap = fs * 0.36; total = ws.reduce((a, b) => a + b, 0) + gap * (group.length - 1); }
  let x = (W - total) / 2; const cy = H * y;
  group.forEach((w, k) => {
    const active = g0 + k === i, pop = active ? 1 + 0.18 * (1 - easeOut((t - w.start) / 0.12)) : 1, cx = x + ws[k] / 2;
    o.save(); o.translate(cx, cy); o.scale(pop, pop); o.textAlign = 'center';
    o.lineWidth = fs * 0.22; o.strokeStyle = '#000'; o.strokeText(w.w.toUpperCase(), 0, 0);
    o.fillStyle = active ? highlight : color; o.fillText(w.w.toUpperCase(), 0, 0); o.restore();
    x += ws[k] + gap;
  });
  o.restore();
}

// ---------- galaxies ----------
/** Stars sprinkled on the sky for night scenes (works with sky()). */
export function starfield(scene, { count = 2500, radius = 1800, seed = 5, size = 2, minY = -0.05 } = {}) {
  const r = rng(seed), pos = [];
  while (pos.length < count * 3) { const u = r() * 2 - 1; if (u < minY) continue; const th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); pos.push(radius * s * Math.cos(th), radius * u, radius * s * Math.sin(th)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, map: dotTexture(), transparent: true, depthWrite: false, fog: false, color: '#dfe8ff' }));
  scene.add(p); return p;
}
function randn(r) { return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r()); }
function spiralPoint(r, R, arms, twist, thick) {
  const d = R * Math.pow(r(), 0.75), arm = Math.floor(r() * arms);
  const a = (arm / arms) * Math.PI * 2 + (d / R) * twist + randn(r) * 0.35 * (1 - d / R * 0.5);
  return [Math.cos(a) * d + randn(r) * R * 0.03, randn(r) * thick * R * Math.exp(-d / R * 2), Math.sin(a) * d + randn(r) * R * 0.03, d / R];
}
/** Spiral galaxy made of points, lying in the XZ plane. Returns group (.points, .core). */
export function galaxy({ count = 20000, radius = 10, arms = 2, twist = 5, color = '#9ec5ff', core = '#ffe0a3', seed = 1, size = 0.06, pixelSize = 0, thickness = 0.06, opacity = 1 } = {}) {
  const r = rng(seed), pos = new Float32Array(count * 3), col = new Float32Array(count * 3), cA = new THREE.Color(core), cB = new THREE.Color(color), pink = new THREE.Color('#ff7ad1'), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const [x, y, z, f] = spiralPoint(r, radius, arms, twist, thickness); pos.set([x, y, z], i * 3);
    c.copy(cA).lerp(cB, Math.min(1, f * 1.6)); if (r() < 0.04 && f > 0.3) c.copy(pink); col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const grp = new THREE.Group();
  grp.points = new THREE.Points(g, new THREE.PointsMaterial({ size: pixelSize || size, sizeAttenuation: !pixelSize, vertexColors: true, map: dotTexture(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  grp.core = glow(core, radius * 0.9, 0.9 * opacity); grp.add(grp.points, grp.core); return grp;
}
/**
 * Two spiral galaxies colliding, simulated with real (softened) gravity: discs of test stars around
 * two cores with dynamical friction, so you get tidal tails and an eventual merger.
 * update(s) shows the system at sim fraction s in [0,1]: 0 far apart, ~0.45 first close pass, ~0.6 tidal tails, ~0.8 second pass, ~0.95 merged.
 * starPos(i, s) gives one star's world position (for "your Sun is here" labels). coreA/coreB are glow sprites.
 */
export function galaxyCollision({ count = 9000, scale = 3, seed = 3, colorA = '#9ec5ff', colorB = '#ffc89a', size = 0.08, steps = 2400, snaps = 240 } = {}) {
  const r = rng(seed), N = count, M = [1, 1.2], eps2 = 0.09;
  const cp = [[-5, 0.4, 0], [5, -0.4, 0]], cv = [[0.4 * 1.2 / 2.2, 0, -0.3 * 1.2 / 2.2], [-0.4 / 2.2, 0, 0.3 / 2.2]];
  const px = new Float32Array(N * 3), pv = new Float32Array(N * 3), owner = new Uint8Array(N), col = new Float32Array(N * 3);
  const tilt = [new THREE.Euler(0.25, 0, 0.15), new THREE.Euler(1.0, 0.5, 0)], v3 = new THREE.Vector3(), w3 = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const k = i < N * 0.45 ? 0 : 1; owner[i] = k;
    const [x, y, z, f] = spiralPoint(r, 2.2, 2, 4, 0.04); const d = Math.max(0.15, Math.hypot(x, z));
    const vc = Math.sqrt(M[k] * d * d / Math.pow(d * d + eps2, 1.5));
    v3.set(x, y, z).applyEuler(tilt[k]); w3.set(-z / d * vc, 0, x / d * vc).applyEuler(tilt[k]);
    px.set([cp[k][0] + v3.x, cp[k][1] + v3.y, cp[k][2] + v3.z], i * 3); pv.set([cv[k][0] + w3.x, cv[k][1] + w3.y, cv[k][2] + w3.z], i * 3);
    c.set(k ? colorB : colorA).lerp(new THREE.Color('#fff2d8'), Math.max(0, 0.6 - f)); if (r() < 0.03) c.set('#ff7ad1'); col.set([c.r, c.g, c.b], i * 3);
  }
  const dt = 0.016, every = Math.ceil(steps / snaps), frames = [], coreFrames = [];
  const P = cp.map((a) => a.slice()), V = cv.map((a) => a.slice());
  const save = () => { frames.push(px.slice()); coreFrames.push([P[0].slice(), P[1].slice()]); };
  save();
  for (let s = 1; s <= steps; s++) {
    // cores: mutual gravity + dynamical friction when close
    const dx = P[1][0] - P[0][0], dy = P[1][1] - P[0][1], dz = P[1][2] - P[0][2], d2 = dx * dx + dy * dy + dz * dz + 0.25, inv = 1 / Math.pow(d2, 1.5), fr = 0.2 * Math.exp(-Math.sqrt(d2) / 1.5);
    const rv = [V[1][0] - V[0][0], V[1][1] - V[0][1], V[1][2] - V[0][2]];
    for (let a = 0; a < 3; a++) { const da = [dx, dy, dz][a]; V[0][a] += (M[1] * da * inv + fr * rv[a] * M[1] / 2.2) * dt; V[1][a] += (-M[0] * da * inv - fr * rv[a] * M[0] / 2.2) * dt; }
    for (let k = 0; k < 2; k++) for (let a = 0; a < 3; a++) P[k][a] += V[k][a] * dt;
    for (let i = 0; i < N; i++) {
      const o = i * 3; let ax = 0, ay = 0, az = 0;
      for (let k = 0; k < 2; k++) { const ex = P[k][0] - px[o], ey = P[k][1] - px[o + 1], ez = P[k][2] - px[o + 2], q = ex * ex + ey * ey + ez * ez + eps2, f = M[k] / (q * Math.sqrt(q)); ax += ex * f; ay += ey * f; az += ez * f; }
      pv[o] += ax * dt; pv[o + 1] += ay * dt; pv[o + 2] += az * dt; px[o] += pv[o] * dt; px[o + 1] += pv[o + 1] * dt; px[o + 2] += pv[o + 2] * dt;
    }
    if (s % every === 0) save();
  }
  const g = new THREE.BufferGeometry(); const live = new Float32Array(N * 3);
  g.setAttribute('position', new THREE.BufferAttribute(live, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const grp = new THREE.Group(); grp.scale.setScalar(scale);
  grp.points = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  grp.coreA = glow('#fff1d0', 1.6); grp.coreB = glow('#ffe0b8', 1.8); grp.add(grp.points, grp.coreA, grp.coreB);
  const at = (s) => { const f = clamp(s) * (frames.length - 1), i = Math.min(frames.length - 2, Math.floor(f)); return [i, f - i]; };
  grp.update = (s) => {
    const [i, u] = at(s), A = frames[i], B = frames[i + 1];
    for (let j = 0; j < live.length; j++) live[j] = A[j] + (B[j] - A[j]) * u;
    g.attributes.position.needsUpdate = true;
    const ca = coreFrames[i], cb = coreFrames[i + 1];
    grp.coreA.position.set(...ca[0].map((x, a) => x + (cb[0][a] - x) * u)); grp.coreB.position.set(...ca[1].map((x, a) => x + (cb[1][a] - x) * u));
  };
  grp.starPos = (idx, s) => { const [i, u] = at(s), A = frames[i], B = frames[i + 1], o = idx * 3; return new THREE.Vector3(A[o] + (B[o] - A[o]) * u, A[o + 1] + (B[o + 1] - A[o + 1]) * u, A[o + 2] + (B[o + 2] - A[o + 2]) * u).multiplyScalar(scale); };
  grp.coreDistance = (s) => { const [i] = at(s), c2 = coreFrames[i]; return Math.hypot(c2[0][0] - c2[1][0], c2[0][1] - c2[1][1], c2[0][2] - c2[1][2]); };
  grp.update(0); return grp;
}

// ---------- top-down town (overhead story shots, works best with style 'ink') ----------
/**
 * Overhead night town: crossing roads with lane marks and crosswalks, city blocks or suburban houses,
 * rooftop details, trees, moving cars with headlights, warm streetlight pools and a crowd of tiny stick people.
 * kind: 'city' | 'suburb'. ash: grey post-blast look (no traffic, no lights). Returns group with update(t)
 * and .lots (array of {x, z} house positions; suburb only) so a story can point at "your house".
 */
export function topDownTown({ kind = 'city', seed = 5, crowd = 260, cars = 40, ash = false, size = 260 } = {}) {
  const g = new THREE.Group(), r = rng(seed);
  const C = ash ? { ground: '#6b6a66', road: '#55534f', walk: '#7b7974', roof: '#77746e', roof2: '#6a6762', grass: '#77786a', tree: '#5d5f55' }
    : { ground: '#2c3448', road: '#363f57', walk: '#4f5a77', roof: '#4a5169', roof2: '#5a4a52', grass: '#2f4a3c', tree: '#2e5240' };
  const flat = (w, d, color, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color)); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; g.add(m); return m; };
  flat(size * 2, size * 2, C.ground, 0);
  const roadW = 14, step = 70, roads = [];
  for (let k = -2; k <= 2; k++) roads.push(k * step);
  for (const p of roads) { flat(size * 2, roadW, C.road, 0.02).position.z = p; flat(roadW, size * 2, C.road, 0.02).position.x = p; for (const s of [-1, 1]) { flat(size * 2, 3, C.walk, 0.03).position.z = p + s * (roadW / 2 + 1.5); flat(3, size * 2, C.walk, 0.03).position.x = p + s * (roadW / 2 + 1.5); } }
  const dash = mat(ash ? '#8a8781' : '#e8e2c8');
  for (const p of roads) for (let x = -size; x < size; x += 8) { if (roads.some((q) => Math.abs(q - x) < roadW)) continue; const a = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 0.35), dash); a.position.set(x, 0.05, p); g.add(a); const b = a.clone(); b.rotation.y = Math.PI / 2; b.position.set(p, 0.05, x); g.add(b); }
  for (const px of roads) for (const pz of roads) for (let i = -5; i <= 5; i++) for (const [dx, dz, rot] of [[i * 1.2, roadW / 2 + 2.5, 0], [i * 1.2, -roadW / 2 - 2.5, 0], [roadW / 2 + 2.5, i * 1.2, 1], [-roadW / 2 - 2.5, i * 1.2, 1]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 3.5), dash); s.position.set(px + dx, 0.05, pz + dz); if (rot) s.rotation.y = Math.PI / 2; g.add(s); }
  const lots = [];
  const block = (cx, cz) => {
    const inner = step - roadW - 8;
    if (kind === 'suburb' || r() < 0.18) {
      flat(inner, inner, C.grass, 0.04).position.set(cx, 0.04, cz);
      if (kind === 'suburb') for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const hx = cx + ox * inner * 0.25, hz = cz + oz * inner * 0.25; const h = house({ color: ash ? '#8d8a84' : ['#c9b79a', '#9fb0c4', '#c49a8a', '#b8b8a0'][Math.floor(r() * 4)], roof: ash ? '#6f6c67' : ['#7a3b30', '#3f4a5e', '#5b4636'][Math.floor(r() * 3)], w: 9, d: 7, h: 4 });
        h.position.set(hx, 0, hz - oz * 4); h.rotation.y = oz > 0 ? Math.PI : 0; g.add(h); lots.push({ x: hx, z: hz + oz * 3.5, dz: oz, house: h });
        for (let i = 0; i < 6; i++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), mat('#5a4636')); post.position.set(hx - 7 + i * 2.8, 0.6, hz + oz * 10); g.add(post); }
      }
      for (let i = 0; i < (kind === 'suburb' ? 5 : 9); i++) { const t = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4 + r() * 1.6, 1), mat(C.tree)); t.position.set(cx + (r() - 0.5) * inner * 0.9, 4, cz + (r() - 0.5) * inner * 0.9); g.add(t); }
      return;
    }
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const w = inner / n - 2, h = 8 + Math.pow(r(), 1.5) * 34, bx = cx - inner / 2 + (i + 0.5) * (inner / n), bz = cz - inner / 2 + (j + 0.5) * (inner / n);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat(r() < 0.5 ? C.roof : C.roof2)); b.position.set(bx, h / 2, bz); g.add(b);
      for (let k = 0; k < 3; k++) { const ac = new THREE.Mesh(r() < 0.5 ? new THREE.BoxGeometry(2 + r() * 2, 1.2, 1.6) : new THREE.CylinderGeometry(0.9, 0.9, 1.4, 12), mat(ash ? '#8a8781' : '#6d7591')); ac.position.set(bx + (r() - 0.5) * w * 0.6, h + 0.7, bz + (r() - 0.5) * w * 0.6); g.add(ac); }
      if (!ash && r() < 0.6) { const win = glow('#ffcf7a', w * 0.25, 0.22); win.position.set(bx, h + 0.2, bz + w / 2); g.add(win); }
    }
  };
  for (let i = 0; i < roads.length - 1; i++) for (let j = 0; j < roads.length - 1; j++) block((roads[i] + roads[i + 1]) / 2, (roads[j] + roads[j + 1]) / 2);
  // streetlight pools
  if (!ash) for (const p of roads) for (let x = -size + 11; x < size; x += 30) for (const s of [-1, 1]) { const l = glow('#ffbf6a', 9, 0.28); l.position.set(x, 0.3, p + s * 8); g.add(l); const l2 = glow('#ffbf6a', 9, 0.28); l2.position.set(p + s * 8, 0.3, x); g.add(l2); }
  // cars
  const carList = [];
  if (!ash) for (let i = 0; i < cars; i++) {
    const c = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.5, 2), mat(['#c0392b', '#2e86c1', '#d4ac0d', '#7d8a99', '#e8e8e8', '#1e8449'][Math.floor(r() * 6)])); body.position.y = 0.8; c.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.8), mat('#22303f')); top.position.set(-0.2, 1.8, 0); c.add(top);
    const hl = glow('#fff2c0', 5, 0.7); hl.position.set(3.4, 0.6, 0); c.add(hl);
    const axisX = r() < 0.5, lane = roads[Math.floor(r() * roads.length)], dir = r() < 0.5 ? 1 : -1;
    carList.push({ c, axisX, lane: lane + dir * 3.2 * (axisX ? 1 : -1), dir, off: r() * size * 2, speed: 8 + r() * 10 }); g.add(c);
  }
  // crowd of tiny stick people (instanced heads + bodies)
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 10, 8), mat('#f4f1ea'), crowd);
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.12, 1.1, 3, 6), mat('#141414'), crowd);
  const people = Array.from({ length: crowd }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (kind === 'city' ? 26 : 60); return { x: Math.cos(a) * d, z: Math.sin(a) * d, a: r() * Math.PI * 2, sp: 0.6 + r() * 1.2 }; });
  if (crowd && !ash) { g.add(heads, bodies); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  g.update = (t) => {
    for (const k of carList) { let u = ((k.off + t * k.speed * k.dir) % (size * 2) + size * 2) % (size * 2) - size; if (k.axisX) { k.c.position.set(u, 0, k.lane); k.c.rotation.y = k.dir > 0 ? 0 : Math.PI; } else { k.c.position.set(k.lane, 0, u); k.c.rotation.y = k.dir > 0 ? -Math.PI / 2 : Math.PI / 2; } }
    if (crowd && !ash) people.forEach((p, i) => {
      const ang = p.a + Math.sin(t * 0.2 + i) * 0.6, x = p.x + Math.cos(ang) * t * p.sp, z = p.z + Math.sin(ang) * t * p.sp;
      e.set(0.5, 0, Math.sin(t * 6 + i) * 0.15); q.setFromEuler(e); m4.compose(v.set(x, 0.9, z), q, one); bodies.setMatrixAt(i, m4);
      m4.compose(v.set(x, 1.9, z), q.identity(), one); heads.setMatrixAt(i, m4);
    });
    heads.instanceMatrix.needsUpdate = bodies.instanceMatrix.needsUpdate = true;
  };
  g.lots = lots; g.update(0); return g;
}
/** Lighting rig for overhead night (or ash-grey day) shots. */
export function topDownLights(scene, { ash = false } = {}) {
  scene.background = new THREE.Color(ash ? '#5f5e5a' : '#1a2033');
  scene.add(new THREE.HemisphereLight(ash ? '#d8d6d0' : '#8fa3d6', ash ? '#4a4844' : '#20263a', ash ? 1.4 : 1.1));
  const moon = new THREE.DirectionalLight(ash ? '#ffffff' : '#b8c6ff', ash ? 1.4 : 0.9); moon.position.set(-40, 100, 30); scene.add(moon);
}
