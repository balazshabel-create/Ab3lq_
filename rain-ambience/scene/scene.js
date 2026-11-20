// Cozy rainy-night bedroom. Every animated element is periodic in LOOP seconds, so the rendered clip loops seamlessly.
// window.renderAt(t) -> JPEG data URL of the frame at time t (0 <= t < LOOP).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const q = new URLSearchParams(location.search);
const W = +q.get('w') || 1920, H = +q.get('h') || 1080, THUMB = q.get('thumb') === '1';
const LOOP = +q.get('loop') || 24;

// ---------------------------------------------------------------- utils
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw, { srgb = true, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8; return t;
}
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });
function shadowAll(o) { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }

// ---------------------------------------------------------------- renderer
const gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
gl.setPixelRatio(1); gl.setSize(W, H, false);
gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05;
gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(gl.domElement);
RectAreaLightUniformsLib.init();

// ---------------------------------------------------------------- outside world (rendered once into a texture)
function buildOutside() {
  const s = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 1.3, 1, 5000); cam.position.set(0, 18, 0); cam.lookAt(0, 22, -100);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1400), new THREE.ShaderMaterial({
    depthWrite: false, uniforms: {},
    vertexShader: 'varying vec2 v; void main(){ v=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec2 v; void main(){ vec3 top=vec3(.010,.018,.045), mid=vec3(.035,.06,.13), low=vec3(.11,.12,.19); float y=v.y; vec3 c=mix(low,mid,smoothstep(.0,.35,y)); c=mix(c,top,smoothstep(.35,1.,y)); gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>\n }',
  }));
  sky.position.set(0, 300, -1500); s.add(sky);
  const r = rng(42);
  // window lights texture for buildings
  const winTex = canvasTex(256, 512, (g, w, h) => { g.fillStyle = '#05070d'; g.fillRect(0, 0, w, h); for (let y = 6; y < h; y += 14) for (let x = 6; x < w; x += 16) { const v = r(); if (v < 0.32) { g.fillStyle = v < 0.08 ? '#bfd4ff' : v < 0.22 ? '#ffc47a' : '#ff9d4f'; g.globalAlpha = 0.5 + r() * 0.5; g.fillRect(x, y, 9, 8); g.globalAlpha = 1; } } });
  for (let layer = 0; layer < 3; layer++) {
    const dist = 260 + layer * 260, n = 34 - layer * 6;
    for (let i = 0; i < n; i++) {
      const w = 18 + r() * 40, h = 30 + Math.pow(r(), 1.6) * (140 - layer * 30), x = (i / n - 0.5) * (dist * 2.4) + (r() - 0.5) * 30;
      const t = winTex.clone(); t.repeat.set(w / 40, h / 60); t.offset.set(r(), r()); t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 20), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color().setScalar(1 - layer * 0.25) }));
      m.position.set(x, h / 2 - 10, -dist); s.add(m);
    }
  }
  // street lights / car lights as soft glows
  const glowTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  for (let i = 0; i < 70; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: r() < 0.7 ? '#ffb45a' : r() < 0.5 ? '#ff5a3c' : '#a9c8ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const d = 120 + r() * 600; sp.position.set((r() - 0.5) * d * 1.6, 2 + r() * 12, -d); sp.scale.setScalar(6 + r() * 14); s.add(sp);
  }
  // near tree silhouettes
  const treeMat = new THREE.MeshBasicMaterial({ color: '#020306' });
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group(), x = (r() - 0.5) * 220, z = -60 - r() * 60;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 30), treeMat); trunk.position.y = 5; g.add(trunk);
    for (let k = 0; k < 7; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(7 + r() * 7, 1), treeMat); b.position.set((r() - 0.5) * 16, 22 + r() * 18, (r() - 0.5) * 8); g.add(b); }
    g.position.set(x, 0, z); s.add(g);
  }
  const groundM = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: '#06080d' })); groundM.rotation.x = -Math.PI / 2; groundM.position.y = -10; s.add(groundM);
  for (let i = 0; i < 40; i++) { const refl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: r() < 0.7 ? '#b9782f' : '#6c86b8', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); const d = 100 + r() * 400; refl.position.set((r() - 0.5) * d * 1.4, -9, -d); refl.scale.set(4 + r() * 6, 18 + r() * 30, 1); s.add(refl); }
  s.fog = new THREE.Fog('#0d1222', 80, 900);
  const rt = new THREE.WebGLRenderTarget(1300, 1000, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace });
  const tm = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
  gl.setRenderTarget(rt); gl.render(s, cam); gl.setRenderTarget(null); gl.toneMapping = tm;
  return rt.texture;
}

// ---------------------------------------------------------------- rain-on-glass shader (original)
const glassFrag = /* glsl */`
uniform sampler2D tOut; uniform float uT; uniform float uLoop; uniform float uAspect; uniform vec2 uLamp;
varying vec2 vUv;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
// static droplets that appear and slowly evaporate (integer cycles per loop => seamless)
vec3 dropsLayer(vec2 uv, float sc, float t, float seed){
  vec2 g=uv*vec2(sc*uAspect, sc); vec2 id=floor(g); vec2 f=fract(g)-.5;
  float r1=h21(id+seed), r2=h21(id+seed+1.7), r3=h21(id+seed+3.3);
  vec2 c=(vec2(r1,r2)-.5)*.6; float size=mix(.12,.32,r3*r3);
  float k=1.+floor(h21(id+seed+5.1)*3.); float life=fract(t/uLoop*k + h21(id+seed+7.9));
  float a=smoothstep(0.,.04,life)*smoothstep(1.,.55,life)*step(.35,h21(id+seed+9.4));
  vec2 d=(f-c)/vec2(1.,1.12); float dist=length(d);
  float m=smoothstep(size,size*.75,dist)*a;
  return vec3(d/size*m, m);
}
// big drops sliding down with a wobble and a trail of tiny droplets
vec4 slideLayer(vec2 uv, float cols, float t, float seed){
  vec2 p=vec2(uv.x*uAspect*cols, uv.y); float id=floor(p.x); float fx=fract(p.x)-.5;
  float r1=h21(vec2(id,seed)), r2=h21(vec2(id,seed+2.)), r3=h21(vec2(id,seed+4.));
  if(r3<.45) return vec4(0.);
  float k=1.+floor(r2*2.); float head=1.15-fract(t/uLoop*k+r1)*1.35;
  float wob=sin(p.y*9.+r1*30.)*.18+sin(p.y*23.+r2*10.)*.06;
  float x=fx-wob; float dy=(p.y-head)*cols*.35;
  float drop=smoothstep(.22,.14,length(vec2(x,dy*.75)));
  float trail=smoothstep(.07,.02,abs(x))*smoothstep(0.,.02,p.y-head)*smoothstep(.55,.0,p.y-head);
  float ty=fract(p.y*cols*1.6+r2); float tiny=smoothstep(.09,.04,length(vec2(x,(ty-.5)*.4)))*smoothstep(0.,.02,p.y-head)*smoothstep(.45,.05,p.y-head);
  vec2 n=vec2(x,dy)*drop*3.+vec2(x,0.)*tiny*2.;
  return vec4(n, max(drop,tiny), trail);
}
vec3 sampleBlur(vec2 uv, float lod){
  vec2 o=vec2(.004,.005)*exp2(lod-3.);
  return (textureLod(tOut,uv,lod).rgb*2.+textureLod(tOut,uv+o,lod).rgb+textureLod(tOut,uv-o,lod).rgb+textureLod(tOut,uv+vec2(o.x,-o.y),lod).rgb+textureLod(tOut,uv+vec2(-o.x,o.y),lod).rgb)/6.;
}
void main(){
  vec2 uv=vUv; float t=uT;
  vec3 s1=dropsLayer(uv,22.,t,1.), s2=dropsLayer(uv,48.,t,7.), s3=dropsLayer(uv,95.,t,13.);
  vec4 a1=slideLayer(uv,5.,t,3.), a2=slideLayer(uv,9.,t,11.);
  vec2 n=s1.xy*.9+s2.xy*.6+s3.xy*.35+a1.xy+a2.xy*.8;
  float drop=clamp(s1.z+s2.z*.8+s3.z*.6+a1.z+a2.z,0.,1.);
  float clear=clamp(a1.w+a2.w*.8,0.,1.);
  float lod=mix(4.6,3.2,clear); lod=mix(lod,1.2,drop);
  vec2 suv=uv - n*.035;
  vec3 col=sampleBlur(suv,lod);
  // rain falling outside (faint streaks behind the glass), integer cycles per loop
  float sx=uv.x*uAspect*140.+uv.y*14.; float sid=floor(sx);
  float sp=3.+floor(h21(vec2(sid,1.))*3.);
  float sy=fract(uv.y*2.5+t/uLoop*sp*4.+h21(vec2(sid,2.)));
  float streak=smoothstep(.12,.0,abs(fract(sx)-.5))*smoothstep(.0,.08,sy)*smoothstep(.35,.1,sy)*step(.6,h21(vec2(sid,3.)));
  col+=vec3(.55,.62,.8)*streak*.06*(1.-drop);
  // fogged glass: slightly lifted, cool; drops darker rim + small warm highlight from the lamp
  col=mix(col,col*.92+vec3(.018,.024,.04),.55*(1.-drop)*(1.-clear*.6));
  // drops: refracted (inverted, sharper) image of the lights + bright crescent rim + tiny specular glint
  float nl=length(n);
  vec3 lens=sampleBlur(uv + n*.09, 0.8);
  col=mix(col, lens*1.35+vec3(.02,.025,.04), drop*.85);
  float rim=smoothstep(.55,.95,nl)*drop;
  float lit=clamp(dot(normalize(n+1e-5),normalize(vec2(.35,-.9)))*.5+.5,0.,1.);
  col+=vec3(.55,.62,.78)*rim*lit*.10;
  col*=1.-.18*rim*(1.-lit);
  float spec=smoothstep(.7,.98,dot(normalize(n+1e-5),normalize(vec2(-.55,.8))))*smoothstep(.25,.55,nl)*drop;
  col+=vec3(1.,.8,.55)*spec*.35;
  // warm reflection of the bedside lamp on the glass
  float lr=exp(-length((uv-uLamp)*vec2(uAspect,1.))*3.2);
  col+=vec3(1.,.62,.32)*lr*.10;
  gl_FragColor=vec4(col,1.);
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- room
const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070c');
const camera = new THREE.PerspectiveCamera(THUMB ? 50 : 52, W / H, 0.05, 100);
if (THUMB) { camera.position.set(-0.55, 1.38, 0.55); camera.lookAt(0.35, 1.42, -4); }
else { camera.position.set(-0.85, 1.32, 1.05); camera.lookAt(0.2, 1.36, -4); }

const R = rng(9);
// textures
const plaster = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#2a3550'; g.fillRect(0, 0, w, h); for (let i = 0; i < 26000; i++) { const v = R(); g.fillStyle = `rgba(${v < 0.5 ? '0,0,0' : '255,255,255'},${0.015 + R() * 0.03})`; g.fillRect(R() * w, R() * h, 2, 2); } }, { repeat: [3, 2] });
const wood = canvasTex(1024, 1024, (g, w, h) => { const cols = ['#4a3122', '#553826', '#3f2a1d', '#5c3d29']; for (let i = 0; i < 8; i++) { g.fillStyle = cols[i % 4]; g.fillRect(0, i * 128, w, 128); for (let k = 0; k < 90; k++) { g.strokeStyle = `rgba(0,0,0,${0.05 + R() * 0.08})`; g.lineWidth = 1 + R() * 2; g.beginPath(); const y = i * 128 + R() * 128; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (R() - 0.5) * 12, w * 0.6, y + (R() - 0.5) * 12, w, y + (R() - 0.5) * 8); g.stroke(); } g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, i * 128, w, 3); g.fillRect(((i * 397) % 900), i * 128, 3, 128); } }, { repeat: [2, 3] });
const knit = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c9b08a'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = `rgba(0,0,0,${0.08 + ((x / 8 + y / 8) % 2) * 0.08})`; g.beginPath(); g.ellipse(x + 4, y + 4, 3, 4, 0.5, 0, 7); g.fill(); } }, { repeat: [6, 6] });
const linen = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d9d2c4'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.05})`; g.fillRect(R() * w, R() * h, 1, 3 + R() * 6); } }, { repeat: [4, 4] });
const rugTex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#6d5a4b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8a7461'; g.lineWidth = 10; g.strokeRect(30, 30, w - 60, h - 60); g.strokeStyle = '#4c3d33'; g.lineWidth = 4; g.strokeRect(60, 60, w - 120, h - 120); for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.06})`; g.fillRect(R() * w, R() * h, 2, 2); } });

// walls / floor / ceiling
const wallMat = std({ map: plaster, roughness: 0.95 });
const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), wallMat); back.position.set(0, 1.6, -4); back.receiveShadow = true;
// cut the window opening: build the back wall from 4 pieces around the window
const WIN = { x: 0.55, y: 1.6, w: 2.5, h: 1.75 };
scene.add(back); back.visible = false;
const piece = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat); m.position.set(x, y, -4); m.receiveShadow = true; scene.add(m); };
piece(9, 3.2 - (WIN.y + WIN.h / 2), 0, (3.2 + WIN.y + WIN.h / 2) / 2);
piece(9, WIN.y - WIN.h / 2, 0, (WIN.y - WIN.h / 2) / 2);
piece(4.5 + WIN.x - WIN.w / 2, WIN.h, (-4.5 + WIN.x - WIN.w / 2) / 2, WIN.y);
piece(4.5 - WIN.x - WIN.w / 2, WIN.h, (4.5 + WIN.x + WIN.w / 2) / 2, WIN.y);
const side = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), wallMat); side.rotation.y = Math.PI / 2; side.position.set(-2.9, 1.6, 0); side.receiveShadow = true; scene.add(side);
const side2 = side.clone(); side2.rotation.y = -Math.PI / 2; side2.position.x = 3.6; scene.add(side2);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 9), std({ map: wood, roughness: 0.55 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(8, 9), std({ color: '#1e2638' })); ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.2; scene.add(ceil);
const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), std({ map: rugTex, roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(-0.6, 0.006, -0.9); rug.receiveShadow = true; scene.add(rug);
// skirting
const skirt = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 0.03), std({ color: '#1b2234' })); skirt.position.set(0, 0.06, -3.98); scene.add(skirt);

// window: frame, mullions, sill, glass
const frameMat = std({ color: '#e6e0d4', roughness: 0.6 });
const fw = 0.07, depth = 0.22;
const fb = (w, h, x, y, z = -4, d = depth) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat); m.position.set(x, y, z); shadowAll(m); scene.add(m); return m; };
fb(WIN.w + fw * 2, fw, WIN.x, WIN.y + WIN.h / 2 + fw / 2); fb(WIN.w + fw * 2, fw, WIN.x, WIN.y - WIN.h / 2 - fw / 2);
fb(fw, WIN.h, WIN.x - WIN.w / 2 - fw / 2, WIN.y); fb(fw, WIN.h, WIN.x + WIN.w / 2 + fw / 2, WIN.y);
fb(0.05, WIN.h, WIN.x, WIN.y, -4.05, 0.08); fb(WIN.w, 0.045, WIN.x, WIN.y + 0.25, -4.05, 0.08);
const sill = fb(WIN.w + 0.4, 0.05, WIN.x, WIN.y - WIN.h / 2 - fw - 0.02, -3.86, 0.36);
const outTex = buildOutside();
const glassMat = new THREE.ShaderMaterial({
  uniforms: { tOut: { value: outTex }, uT: { value: 0 }, uLoop: { value: LOOP }, uAspect: { value: WIN.w / WIN.h }, uLamp: { value: new THREE.Vector2(0.12, 0.08) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: glassFrag,
});
const glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), glassMat); glass.position.set(WIN.x, WIN.y, -4.08); scene.add(glass);
// cool light spilling in from the window
const winLight = new THREE.RectAreaLight('#6f8fd6', 2.2, WIN.w, WIN.h); winLight.position.set(WIN.x, WIN.y, -4.0); winLight.lookAt(WIN.x, WIN.y, 0); scene.add(winLight);
const moon = new THREE.DirectionalLight('#7c96d8', 0.35); moon.position.set(WIN.x + 1, 4, -8); moon.target.position.set(-0.5, 0, 0); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); Object.assign(moon.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); scene.add(moon, moon.target);

// curtains (folded linen)
function curtain(x, w) {
  const geo = new THREE.PlaneGeometry(w, 2.75, 60, 1); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i); p.setZ(i, Math.sin(u * 15) * 0.06 + Math.sin(u * 37 + 1.3) * 0.015); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, std({ map: linen, color: '#a39a8c', side: THREE.DoubleSide, roughness: 1 })); m.position.set(x, 1.62, -3.82); shadowAll(m); scene.add(m);
}
curtain(WIN.x - WIN.w / 2 - 0.28, 0.62); curtain(WIN.x + WIN.w / 2 + 0.28, 0.62);
const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, WIN.w + 1.4), std({ color: '#2a2622', metalness: 0.6, roughness: 0.4 })); rod.rotation.z = Math.PI / 2; rod.position.set(WIN.x, 3.0, -3.8); scene.add(rod);

// bed (left)
const bed = new THREE.Group(); bed.position.set(-1.75, 0, -2.75); scene.add(bed);
const woodMat = std({ map: wood, color: '#8a6a52', roughness: 0.6 });
const bframe = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.28, 2.2), woodMat); bframe.position.y = 0.2; bed.add(bframe);
const head = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.05, 0.08, 4, 0.03), woodMat); head.position.set(0, 0.75, -1.12); bed.add(head);
const matt = new THREE.Mesh(new RoundedBoxGeometry(1.68, 0.24, 2.1, 4, 0.06), std({ map: linen, color: '#efeae0' })); matt.position.y = 0.46; bed.add(matt);
const duvet = new THREE.Mesh(new RoundedBoxGeometry(1.74, 0.16, 1.45, 6, 0.07), std({ map: linen, color: '#8fa3c6', roughness: 1 })); duvet.position.set(0, 0.62, 0.36); duvet.rotation.x = -0.02; bed.add(duvet);
const throwB = new THREE.Mesh(new RoundedBoxGeometry(1.76, 0.07, 0.55, 4, 0.03), std({ map: knit, color: '#d6a85a', roughness: 1 })); throwB.position.set(0, 0.72, 0.7); bed.add(throwB);
for (const [x, c] of [[-0.42, '#f1ece2'], [0.42, '#e9e3d6']]) { const p = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.2, 0.42, 6, 0.09), std({ map: linen, color: c })); p.position.set(x, 0.66, -0.78); p.rotation.x = 0.35; bed.add(p); }
const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.38, 0.14, 6, 0.06), std({ map: knit, color: '#9c6b4e' })); cushion.position.set(0.15, 0.82, -0.55); cushion.rotation.set(-0.35, 0.2, 0.1); bed.add(cushion);
shadowAll(bed);

// nightstand + lamp + props (between bed and window)
const ns = new THREE.Group(); ns.position.set(-0.55, 0, -3.62); scene.add(ns);
const nsBody = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.55, 0.42, 3, 0.02), woodMat); nsBody.position.y = 0.3; ns.add(nsBody);
const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.01), std({ color: '#6b4f3b' })); drawer.position.set(0, 0.38, 0.215); ns.add(drawer);
const knob = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 8), std({ color: '#c9a65a', metalness: 0.8, roughness: 0.3 })); knob.position.set(0, 0.38, 0.23); ns.add(knob);
const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.26, 32), std({ color: '#c8b8a0', roughness: 0.35 })); lampBase.position.set(0.08, 0.71, -0.02); ns.add(lampBase);
const lampNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14), std({ color: '#3a3026', metalness: 0.7 })); lampNeck.position.set(0.08, 0.9, -0.02); ns.add(lampNeck);
const shadeMat = new THREE.MeshStandardMaterial({ color: '#f3dcb4', emissive: '#ffb45c', emissiveIntensity: 1.3, side: THREE.DoubleSide, roughness: 1 });
const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.19, 0.22, 40, 1, true), shadeMat); shade.position.set(0.08, 1.03, -0.02); ns.add(shade);
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff1d0' })); bulb.position.set(0.08, 0.98, -0.02); ns.add(bulb);
for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.2 - i * 0.01, 0.035, 0.27), std({ color: ['#6b2f2a', '#2f4a6b', '#c9b48a'][i], roughness: 0.7 })); b.position.set(-0.13, 0.6 + i * 0.036, 0.04); b.rotation.y = 0.1 * i - 0.1; ns.add(b); }
const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 24), std({ color: '#e8e2d6', roughness: 0.4 })); mug.position.set(-0.13, 0.75, 0.05); ns.add(mug);
shadowAll(ns); shade.castShadow = false; bulb.castShadow = false;
const lamp = new THREE.PointLight('#ffb062', 5.5, 0, 2); lamp.position.set(-0.47, 0.98, -3.64); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.002; lamp.shadow.radius = 6; scene.add(lamp);
const fill = new THREE.HemisphereLight('#2c3f6a', '#1a120c', 0.6); scene.add(fill);

// sill props: plant + candle jar + small books
const plant = new THREE.Group(); plant.position.set(WIN.x + 0.85, WIN.y - WIN.h / 2 - fw + 0.01, -3.82); scene.add(plant);
const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.13, 24), std({ color: '#b5653f', roughness: 0.9 })); pot.position.y = 0.065; plant.add(pot);
for (let i = 0; i < 14; i++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), std({ color: i % 2 ? '#2f5a3a' : '#3a6b45', roughness: 0.7 })); const a = (i / 14) * Math.PI * 2; leaf.scale.set(0.5, 1.6, 0.25); leaf.position.set(Math.cos(a) * 0.06, 0.2 + (i % 3) * 0.04, Math.sin(a) * 0.05); leaf.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6); plant.add(leaf); }
shadowAll(plant);
for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.22), std({ color: ['#3a4a5a', '#8a6a3a'][i] })); b.position.set(WIN.x - 0.85, WIN.y - WIN.h / 2 - fw + 0.025 + i * 0.03, -3.85); b.rotation.y = 0.2 * i; shadowAll(b); scene.add(b); }

// bookshelf (right of the window)
const shelf = new THREE.Group(); shelf.position.set(2.35, 0, -3.78); scene.add(shelf);
const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.32), woodMat); sideL.position.set(-0.45, 0.95, 0); shelf.add(sideL);
const sideR = sideL.clone(); sideR.position.x = 0.45; shelf.add(sideR);
const BR = rng(21);
for (let k = 0; k < 5; k++) {
  const y = 0.05 + k * 0.45; const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.025, 0.32), woodMat); board.position.y = y; shelf.add(board);
  if (k === 4) break;
  let x = -0.42;
  while (x < 0.36) {
    if (BR() < 0.12) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.09, 16), std({ color: '#a8603a' })); pl.position.set(x + 0.06, y + 0.06, 0); shelf.add(pl); for (let j = 0; j < 6; j++) { const lf = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), std({ color: '#3a6b45' })); lf.scale.set(0.6, 1.5, 0.3); lf.position.set(x + 0.06 + Math.cos(j) * 0.03, y + 0.15 + (j % 2) * 0.03, Math.sin(j) * 0.03); lf.rotation.z = Math.cos(j) * 0.7; shelf.add(lf); } x += 0.14; continue; }
    const bw = 0.025 + BR() * 0.035, bh = 0.24 + BR() * 0.13;
    const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.22 + BR() * 0.05), std({ color: ['#6b2f2a', '#2f4a6b', '#c9b48a', '#3d5a3f', '#8a6a3a', '#5a4a6b', '#d8cfc0'][Math.floor(BR() * 7)], roughness: 0.8 }));
    book.position.set(x + bw / 2, y + 0.012 + bh / 2, 0.02); if (BR() < 0.1) book.rotation.z = 0.15; shelf.add(book); x += bw + 0.004;
  }
}
shadowAll(shelf);
// warm fairy lights draped along the curtain rod (static, no flicker)
const fairy = new THREE.Group(); scene.add(fairy);
const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffcf8a' });
for (let i = 0; i <= 46; i++) {
  const u = i / 46, x = WIN.x - WIN.w / 2 - 0.55 + u * (WIN.w + 1.1);
  const sag = 0.16 * Math.sin(((u * 3) % 1) * Math.PI);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), bulbMat); b.position.set(x, 2.96 - sag, -3.74); fairy.add(b);
}
const fairyGlow = new THREE.PointLight('#ffb870', 0.6, 3, 2); fairyGlow.position.set(WIN.x, 2.8, -3.5); scene.add(fairyGlow);

// wall art above the bed (simple framed print)
const art = canvasTex(400, 520, (g, w, h) => { g.fillStyle = '#d9cfbd'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5d7392'); gr.addColorStop(1, '#c9a27a'); g.fillStyle = gr; g.fillRect(40, 40, w - 80, h - 80); g.fillStyle = '#2d3b4e'; g.beginPath(); g.moveTo(40, h - 160); g.lineTo(160, h - 280); g.lineTo(260, h - 190); g.lineTo(w - 40, h - 300); g.lineTo(w - 40, h - 40); g.lineTo(40, h - 40); g.fill(); });
const artM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.025), [std({ color: '#2a2018' }), std({ color: '#2a2018' }), std({ color: '#2a2018' }), std({ color: '#2a2018' }), std({ map: art }), std({ color: '#2a2018' })]);
artM.position.set(-2.88, 1.75, -2.6); artM.rotation.y = Math.PI / 2; shadowAll(artM); scene.add(artM);

// ---------------------------------------------------------------- post: bloom + grain + vignette
const composer = new EffectComposer(gl); composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.32, 0.65, 0.82));
composer.addPass(new OutputPass());
const grain = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSeed: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform float uSeed; varying vec2 vUv; float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+uSeed)*43758.5453); } void main(){ vec4 c=texture2D(tDiffuse,vUv); float v=smoothstep(1.15,.35,length((vUv-.5)*vec2(1.25,1.))); c.rgb*=mix(.55,1.,v); c.rgb+=(h(vUv*1000.)-.5)*.035; gl_FragColor=c; }',
});
composer.addPass(grain);

// ---------------------------------------------------------------- frame API
window.renderAt = (t) => {
  const ph = ((t % LOOP) + LOOP) % LOOP;
  glassMat.uniforms.uT.value = ph;
  grain.uniforms.uSeed.value = (ph * 37.17) % 100;
  composer.render();
  return gl.domElement.toDataURL('image/jpeg', 0.95);
};
window.ready = true;
