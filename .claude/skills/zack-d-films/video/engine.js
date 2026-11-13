// Runs inside headless Chromium. Exposes window.renderAt(seconds) -> JPEG data URL.
import * as THREE from 'three';
import * as lib from './lib.js';

const q = new URLSearchParams(location.search);
const W = +q.get('w') || 720, H = +q.get('h') || 1280;
try {
  await document.fonts.load('900 64px Inter');
  const spec = (await import('/project/scenes.mjs')).default;
  const timings = await (await fetch('/project/build/timings.json')).json();

  const gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1); gl.setSize(W, H, false);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1;
  gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap;

  const out = document.createElement('canvas'); out.width = W; out.height = H; document.body.appendChild(out);
  const o = out.getContext('2d', { willReadFrequently: true });

  const dispose = (s) => s.traverse((ob) => {
    ob.geometry?.dispose?.();
    for (const m of [].concat(ob.material || [])) { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose?.(); }
  });

  let cur = -1, st = null;
  function enter(i) {
    if (st) dispose(st.scene);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 6000);
    camera.position.set(0, 1.6, 6); camera.lookAt(0, 1.2, 0);
    const fx = lib.makeFx();
    const s = timings.scenes[i];
    const ctx = { THREE, scene, camera, renderer: gl, lib, fx, W, H, index: i, duration: s.duration };
    const update = spec.scenes[i].build?.(ctx) || (() => {});
    st = { scene, camera, fx, update, ctx }; cur = i;
  }

  window.renderAt = (time) => {
    let i = timings.scenes.findIndex((s) => time < s.start + s.duration);
    if (i < 0) i = timings.scenes.length - 1;
    if (i !== cur) enter(i);
    const s = timings.scenes[i], t = Math.max(0, time - s.start), p = Math.min(1, t / s.duration);
    lib.resetFx(st.fx);
    st.update(t, p);
    gl.render(st.scene, st.camera);
    o.drawImage(gl.domElement, 0, 0, W, H);
    lib.drawFx(o, st.fx, W, H, time);
    lib.drawCaption(o, s.words, t, W, H, spec.scenes[i].captions ?? spec.captions);
    return out.toDataURL('image/jpeg', 0.92);
  };
  window.engine = { ready: true, total: timings.total };
} catch (e) {
  window.engine = { ready: false, error: String(e && e.stack || e) };
}
