// What If We Hit Another Galaxy? — scene spec for the zack-d-films video engine.

const NIGHT = { skyTop: '#050a20', skyBottom: '#1b2550', sunColor: '#a9bbff', sunIntensity: 1.3, ambient: 0.7, ground: '#2d4a2a' };
const HOT = { skyTop: '#c2410c', skyBottom: '#ffb15c', sunColor: '#ffd29a', sunIntensity: 3.2, ambient: 0.9, ground: '#9c8a3c' };

/** Shared set: a guy eating cereal on his porch. */
function porch({ THREE, scene, lib }, o = {}) {
  const { skyTop = '#2f74d0', skyBottom = '#d6ecff', sunColor, sunIntensity = 2.4, ambient = 0.7, ground = '#6aa84f' } = o;
  const env = lib.sky(scene, { top: skyTop, bottom: skyBottom, sunColor, sunIntensity, ambient, sunPos: [18, 30, 25], fogNear: 40, fogFar: 380 });
  lib.ground(scene, { color: ground });
  const house = lib.house({ color: '#f1e3c6', roof: '#8e3b2e', w: 7, d: 5, h: 3 }); house.position.set(0, 0, -4.2); scene.add(house);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 3.5), lib.mat('#a0703f')); deck.position.set(0, 0.12, -0.2); deck.receiveShadow = true; scene.add(deck);
  for (const [x, z, s] of [[-9, -12, 1], [8, -15, 2], [14, -30, 3], [-16, -26, 4], [4, -40, 5], [-12, 25, 6], [10, 40, 7]]) { const t = lib.tree({ height: 5 + s, seed: s }); t.position.set(x, 0, z); scene.add(t); }
  const chair = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.6), lib.mat('#7a4a2a')); seat.position.y = 0.62; chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.08), lib.mat('#7a4a2a')); back.position.set(0, 1.0, -0.28); chair.add(back);
  for (const [x, z] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), lib.mat('#5b361d')); l.position.set(x, 0.32, z); chair.add(l); }
  chair.traverse((m) => { if (m.isMesh) m.castShadow = true; }); scene.add(chair);
  const guy = lib.person({ shirt: '#e94b3c', pants: '#2b3a55' }); guy.position.set(0, -0.12, 0.05); scene.add(guy);
  const P = guy.parts; P.legL.rotation.x = P.legR.rotation.x = -1.45;
  const bowl = lib.bowl(); bowl.position.set(-0.05, 1.08, 0.42); guy.add(bowl);
  P.armL.rotation.set(-1.1, 0, 0.35);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.22), lib.mat('#c9ced6', { metalness: 0.8, roughness: 0.3 })); spoon.position.set(0, -0.68, 0.1); P.armR.add(spoon);
  const eat = (t, speed = 1) => { const k = 0.5 - 0.5 * Math.cos(t * 2.4 * speed); P.armR.rotation.set(-0.9 - k * 1.25, 0, -0.1 - k * 0.3); lib.mouth(guy, k > 0.8 ? (k - 0.8) * 3 : 0); P.head.rotation.x = -k * 0.08; };
  return { env, guy, P, eat };
}

/** Night porch with Andromeda hanging in the sky behind the house. */
function nightSky(ctx) {
  const { scene, lib } = ctx; const s = porch(ctx, NIGHT);
  lib.starfield(scene, { count: 2500, radius: 2000 });
  const andromeda = lib.galaxy({ count: 45000, radius: 700, pixelSize: 3, color: '#a9c4ff', seed: 21, thickness: 0.05 });
  andromeda.position.set(-550, 1000, -1400); andromeda.rotation.set(1.05, 0.3, 0.45); scene.add(andromeda);
  return { ...s, andromeda };
}

export default {
  voice: 'am_michael',
  speed: 1.08,
  music: { style: 'space', volume: 0.16 },
  scenes: [
    { // 1 hook
      vo: 'This is what the night sky would look like if our galaxy crashed into another one.',
      sfx: [{ type: 'boom', at: 0.2, gain: 0.7 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = nightSky(ctx);
        return (t, p) => {
          s.eat(t); s.P.head.rotation.x = -0.15;
          lib.orbit(camera, { target: [0, 2.9, 0], radius: 4.2 - p * 0.4, angle: 0.3, height: 0.9 });
          s.andromeda.rotation.z = 0.45 + t * 0.01;
        };
      },
    },
    { // 2 zoom out: Earth -> Milky Way
      vo: 'Our galaxy, the Milky Way, has hundreds of billions of stars, and our Sun is just one of them.',
      sfx: ['whoosh'],
      build({ scene, camera, lib, THREE }) {
        lib.space(scene, { stars: 2500 });
        const earth = lib.planet({ kind: 'earth', radius: 1 }); scene.add(earth);
        const mw = lib.galaxy({ count: 120000, radius: 40000, pixelSize: 2.4, seed: 2, twist: 6, thickness: 0.04 }); mw.position.set(-26000, 0, 0); scene.add(mw);
        const tag = lib.label('YOU ARE HERE', { height: 1, bg: 'rgba(233,75,60,.9)' }); scene.add(tag); const asp = tag.scale.x / tag.scale.y;
        const dot = lib.glow('#ffe9a8', 1); scene.add(dot);
        camera.far = 400000; camera.updateProjectionMatrix();
        const look = new THREE.Vector3();
        return (t, p) => {
          const k = lib.ease(Math.min(1, p * 1.1)), d = 3 * Math.pow(140000 / 3, k);
          look.set(lib.lerp(0, -19000, lib.easeRange(k, 0.55, 1)), 0, 0);
          camera.position.set(look.x + d * 0.15, d * 0.75, d * 0.65); camera.lookAt(look);
          earth.rotation.y = t * 0.3;
          tag.visible = dot.visible = k > 0.45; tag.scale.set(d * 0.03 * asp, d * 0.03, 1); tag.position.set(0, d * 0.05, 0); dot.scale.setScalar(d * 0.02);
        };
      },
    },
    { // 3 Andromeda approaching
      vo: "And it's not alone. Our neighbor, Andromeda, is heading toward us at about a hundred and ten kilometers per second.",
      sfx: [{ type: 'whoosh', at: 0.3 }, { type: 'pop', at: 3.6 }],
      build({ scene, camera, lib, fx }) {
        lib.space(scene, { stars: 3000 });
        const mw = lib.galaxy({ count: 25000, radius: 10, size: 0.14, seed: 2 }); mw.position.set(0, -9, 0); mw.rotation.set(0.5, 0, 0.2); scene.add(mw);
        const an = lib.galaxy({ count: 25000, radius: 12, size: 0.16, seed: 5, color: '#ffd0a6', core: '#fff0cc' }); an.rotation.set(1.1, 0.4, -0.5); scene.add(an);
        const tagMW = lib.label('MILKY WAY', { height: 1.6, bg: 'rgba(30,70,140,.85)' }); tagMW.position.set(0, -15, 4); scene.add(tagMW);
        const tagAN = lib.label('ANDROMEDA', { height: 1.6, bg: 'rgba(160,80,30,.85)' }); scene.add(tagAN);
        camera.position.set(0, 0, 68); camera.lookAt(0, 0, 0);
        return (t, p) => {
          an.position.set(lib.lerp(4, 2, p), lib.lerp(14, 9, p), lib.lerp(-6, 0, p)); tagAN.position.set(an.position.x, an.position.y + 7, an.position.z + 4);
          mw.rotation.y = t * 0.08; an.rotation.y = 0.4 - t * 0.06;
          if (t > 3.6) { fx.title = '110 KM/S'; fx.titleY = 0.13; fx.titleColor = '#ffd36b'; }
          camera.position.z = 68 - p * 6;
        };
      },
    },
    { // 4 coin flip
      vo: "But scientists aren't sure they'll actually hit. Some studies call it a coin flip. Others think it's more likely.",
      sfx: [{ type: 'ding', at: 2.2 }],
      build({ scene, camera, lib, THREE, fx }) {
        lib.space(scene, { stars: 2500, keyIntensity: 3.5 });
        const a = lib.galaxy({ count: 15000, radius: 12, size: 0.16, seed: 2, opacity: 0.6 }); a.position.set(-8, -10, -30); a.rotation.x = 0.6; scene.add(a);
        const b = lib.galaxy({ count: 15000, radius: 12, size: 0.16, seed: 5, color: '#ffd0a6', opacity: 0.6 }); b.position.set(9, 12, -34); b.rotation.set(1.1, 0, -0.4); scene.add(b);
        const coin = new THREE.Group(); scene.add(coin);
        const disk = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.25, 64), lib.mat('#e8b84a', { metalness: 0.9, roughness: 0.25 })); disk.rotation.x = Math.PI / 2; coin.add(disk);
        const face = lib.label('?', { height: 2.4, bg: null, color: '#7a5410', font: '900 96px Inter' }); face.position.z = 0.2; coin.add(face);
        const light = new THREE.PointLight('#ffffff', 40, 0, 1.5); light.position.set(3, 3, 6); scene.add(light);
        camera.position.set(0, 0, 11); camera.lookAt(0, 0, 0);
        return (t) => {
          const k = lib.easeOut(lib.range(t, 0, 2.2)); coin.rotation.x = k * Math.PI * 8; coin.position.y = Math.sin(k * Math.PI) * 2.5; face.visible = Math.cos(coin.rotation.x) > 0.2;
          coin.rotation.y = Math.sin(t) * 0.25;
          if (t > 2.2) { fx.title = '50/50?'; fx.titleY = 0.2; fx.titleColor = '#ffd36b'; }
          if (t > 4.2) { fx.title = 'MAYBE MORE?'; fx.titleSize = 76; }
        };
      },
    },
    { // 5 Andromeda grows in the sky
      vo: 'If it happens, Andromeda would slowly grow in our sky over billions of years, until it fills the whole night.',
      sfx: [{ type: 'riser' }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = nightSky(ctx);
        return (t, p) => {
          s.eat(t); s.P.head.rotation.x = -0.2;
          const g = lib.lerp(0.12, 1.25, lib.easeIn(p)); s.andromeda.scale.setScalar(g); s.andromeda.position.set(-550, lib.lerp(800, 1000, p), -1400);
          lib.orbit(camera, { target: [0, 2.9, 0], radius: 4.2, angle: 0.3 - p * 0.15, height: 0.9 });
          fx.title = `+${(p * 4).toFixed(1)} BILLION YEARS`; fx.titleSize = 52; fx.titleY = 0.1;
        };
      },
    },
    { // 6 wide collision
      vo: "But here's the crazy part. The stars themselves would almost never crash into each other.",
      sfx: [{ type: 'boom', at: 2.4, gain: 0.7 }],
      build({ scene, camera, lib }) {
        lib.space(scene, { stars: 2500 });
        const sim = lib.galaxyCollision({ count: 12000, scale: 3, size: 0.14 }); scene.add(sim);
        return (t, p) => {
          sim.update(lib.lerp(0.3, 0.6, p));
          lib.orbit(camera, { target: [0, 0, 0], radius: lib.lerp(40, 30, p), angle: 0.4 + p * 0.4, height: lib.lerp(24, 16, p) });
        };
      },
    },
    { // 7 grain of sand
      vo: 'If the Sun were a grain of sand, the next closest star would be about thirty kilometers away.',
      sfx: [{ type: 'pop', at: 0.4 }, { type: 'whoosh', at: 1.5 }, { type: 'pop', at: 4.2 }],
      build({ scene, camera, lib, THREE }) {
        lib.sky(scene, { top: '#1b3c78', bottom: '#f3c98b', sunPos: [-30, 15, -20], sunColor: '#ffd9a0', fogNear: 60, fogFar: 900 });
        lib.ground(scene, { color: '#d9b77a', size: 3000 });
        const grain = (x, z) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05, 0), lib.mat('#fff2c4', { emissive: '#ffcc55', emissiveIntensity: 1.5 })); m.position.y = 0.05; g.add(m); const h = lib.glow('#ffd070', 0.6); h.position.y = 0.06; g.add(h); g.position.set(x, 0, z); scene.add(g); return { g, h }; };
        const sun = grain(0, 0), next = grain(160, -260);
        const t1 = lib.label('SUN', { height: 0.12, bg: 'rgba(0,0,0,.6)' }); scene.add(t1);
        const t2 = lib.label('NEXT STAR: 30 KM', { height: 34, bg: 'rgba(0,0,0,.6)' }); t2.position.set(160, 40, -260); scene.add(t2);
        camera.far = 5000; camera.updateProjectionMatrix();
        return (t, p) => {
          const k = lib.ease(lib.range(t, 1.4, 4.2)); const h = 0.25 * Math.pow(500 / 0.25, k);
          camera.position.set(lib.lerp(0.25, -h * 0.25, k), h, lib.lerp(0.55, h * 0.45, k)); camera.lookAt(lib.lerp(0, 80, k), 0, lib.lerp(0, -130, k));
          t1.scale.set(0.12 * (1 + h * 0.15) * t1.scale.x / t1.scale.y, 0.12 * (1 + h * 0.15), 1); t1.position.set(0, 0.15 + h * 0.03, 0);
          sun.h.scale.setScalar(0.6 + h * 0.03); next.h.scale.setScalar(0.6 + h * 0.03);
          t2.visible = t > 4.2;
        };
      },
    },
    { // 8 gas clouds ignite
      vo: 'Instead, giant clouds of gas would slam together and light up with billions of brand-new stars.',
      sfx: [{ type: 'boom', at: 1.0 }, { type: 'hit', at: 1.0, gain: 0.5 }],
      build({ scene, camera, lib, fx }) {
        lib.space(scene, { stars: 2000 });
        const sim = lib.galaxyCollision({ count: 12000, scale: 3, size: 0.14 }); scene.add(sim);
        const bursts = lib.particles(900, { color: '#ff6fcf', size: 0.35, spread: 9, shape: 'ball', seed: 9 }); scene.add(bursts.points);
        return (t, p) => {
          const s = lib.lerp(0.43, 0.55, p); sim.update(s);
          bursts.points.position.copy(sim.coreA.position).lerp(sim.coreB.position, 0.5).multiplyScalar(3);
          const b = lib.easeOut(lib.range(t, 1.0, 3)); bursts.points.material.opacity = 0.7 * b * (1 - lib.range(t, 4, 6) * 0.6); bursts.points.scale.setScalar(0.3 + b * 1.2);
          lib.orbit(camera, { target: [bursts.points.position.x, 0, bursts.points.position.z], radius: lib.lerp(30, 24, p), angle: 1.2 + p * 0.5, height: 14 });
          fx.flash = t > 1 ? Math.max(0, 0.5 - (t - 1) * 1.5) : 0; if (t > 1 && t < 1.8) lib.shake(camera, 0.3, t);
        };
      },
    },
    { // 9 the Sun gets flung
      vo: 'Our solar system could get flung way out into a totally new part of the galaxy.',
      sfx: ['whoosh'],
      build({ scene, camera, lib, THREE }) {
        lib.space(scene, { stars: 2000 });
        const sim = lib.galaxyCollision({ count: 12000, scale: 3, size: 0.13 }); scene.add(sim);
        // pick a galaxy-A star that ends up far out in a tidal tail (but not lost entirely)
        const N = 12000, A = Math.floor(N * 0.45), d = [];
        for (let i = 0; i < A; i += 7) { sim.update(0.75); const c = sim.coreA.position.clone().multiplyScalar(3); d.push([sim.starPos(i, 0.75).distanceTo(c), i]); }
        d.sort((x, y) => x[0] - y[0]); const idx = d[Math.floor(d.length * 0.9)][1];
        const sun = lib.glow('#ffef9a', 2.2); scene.add(sun);
        const tag = lib.label('SUN', { height: 1.6, bg: 'rgba(233,75,60,.9)' }); scene.add(tag);
        const look = new THREE.Vector3(), mid = new THREE.Vector3();
        return (t, p) => {
          const s = lib.lerp(0.5, 0.75, p); sim.update(s);
          const sp = sim.starPos(idx, s); sun.position.copy(sp); tag.position.copy(sp).add(new THREE.Vector3(0, 2.4, 0));
          mid.copy(sim.coreA.position).lerp(sim.coreB.position, 0.5).multiplyScalar(3); look.copy(mid).lerp(sp, 0.5);
          lib.orbit(camera, { target: [look.x, look.y, look.z], radius: 44 + sp.distanceTo(mid) * 1.3, angle: 2.0 + p * 0.3, height: look.y + 26 });
        };
      },
    },
    { // 10 black holes merge
      vo: 'Eventually, the giant black holes at their centers would spiral together and merge.',
      sfx: [{ type: 'riser', length: 3.6 }, { type: 'boom', at: 3.6 }],
      build({ scene, camera, lib, THREE, fx }) {
        lib.space(scene, { stars: 3000 });
        const hole = () => {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 24), new THREE.MeshBasicMaterial({ color: '#000' })));
          const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 16, 80), lib.glowMat('#ffb35c', { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })); ring.rotation.x = Math.PI / 2 - 0.45; g.add(ring);
          const halo = lib.glow('#ff9a3c', 4, 0.6); g.add(halo); scene.add(g); return g;
        };
        const a = hole(), b = hole();
        const merged = lib.glow('#ffffff', 1); scene.add(merged);
        camera.position.set(0, 4, 13); camera.lookAt(0, 0, 0);
        return (t) => {
          const k = lib.range(t, 0, 3.6), r = lib.lerp(4, 0.2, Math.pow(k, 1.6)), ang = Math.pow(k, 2.2) * 30;
          const done = t > 3.6;
          b.visible = !done;
          a.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r); b.position.set(-Math.cos(ang) * r, 0, -Math.sin(ang) * r);
          if (done) { a.position.set(0, 0, 0); b.visible = false; a.scale.setScalar(1.4); merged.scale.setScalar(2 + (t - 3.6) * 10); merged.material.opacity = Math.max(0, 1 - (t - 3.6) * 2.5); }
          fx.flash = done ? Math.max(0, 0.9 - (t - 3.6) * 2) : 0;
          camera.position.set(0, 4 - k * 1.5, 13 - k * 3); camera.lookAt(0, 0, 0); if (t > 2.6 && t < 4.4) lib.shake(camera, 0.08, t);
        };
      },
    },
    { // 11 Milkomeda
      vo: 'Leaving one huge, blobby galaxy that scientists nicknamed Milkomeda.',
      sfx: [{ type: 'ding', at: 1.2 }],
      build({ scene, camera, lib, fx }) {
        lib.space(scene, { stars: 2500 });
        const sim = lib.galaxyCollision({ count: 12000, scale: 3, size: 0.13 }); scene.add(sim);
        return (t, p) => {
          sim.update(lib.lerp(0.9, 1, p));
          lib.orbit(camera, { target: [0, 0, 0], radius: 26, angle: t * 0.25, height: 12 });
          if (t > 1.2) { fx.title = 'MILKOMEDA'; fx.titleY = 0.18; fx.titleColor = '#ffd36b'; }
        };
      },
    },
    { // 12 the Sun got us first
      vo: 'And honestly? By then, the Sun will probably have made Earth way too hot for us anyway.',
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = porch(ctx, HOT);
        return (t) => {
          lib.orbit(camera, { target: [0, 1.6, 0], radius: 3.4, angle: -0.3 + t * 0.03, height: 1.6 });
          const sh = lib.easeRange(t, 2.0, 2.4) * (1 - lib.easeRange(t, 3.0, 3.5));
          s.eat(t > 3.6 ? t : 3.6);
          s.P.head.rotation.z = sh * 0.15; s.P.torso.position.y = 1.2 + sh * 0.06; s.P.armL.rotation.z = 0.35 - sh * 0.8;
          fx.tint = '#ff6a00'; fx.tintAmount = 0.12 + Math.sin(t * 3) * 0.03;
        };
      },
    },
    { // 13 loop
      vo: '', duration: 1.4, captions: false,
      sfx: [{ type: 'boom', at: 0.1, gain: 0.6 }],
      build(ctx) {
        const { camera, lib, fx } = ctx; const s = nightSky(ctx);
        return (t) => { s.eat(t); s.P.head.rotation.x = -0.15; lib.orbit(camera, { target: [0, 2.9, 0], radius: 4.2, angle: 0.3, height: 0.9 }); fx.fade = Math.max(0, 1 - t * 1.5); };
      },
    },
  ],
};
