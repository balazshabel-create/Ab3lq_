// Macro "rain on glass" close-up: blue city bokeh behind a wet window, full frame.
// All motion is periodic in LOOP seconds -> the clip loops seamlessly. window.renderAt(t) -> JPEG data URL.
import * as THREE from 'three';

const q = new URLSearchParams(location.search);
const W = +q.get('w') || 1920, H = +q.get('h') || 1080, LOOP = +q.get('loop') || 24, SEED = +q.get('seed') || 3;

const gl = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
gl.setPixelRatio(1); gl.setSize(W, H, false); gl.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(gl.domElement);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = (mat) => { const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)); return s; };
const vert = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';

// ---------------------------------------------------------------- pass 1: bokeh background (rendered once)
const bokehFrag = /* glsl */`
varying vec2 vUv; uniform float uAspect; uniform float uSeed;
float h(float n){ return fract(sin(n*127.1+uSeed*31.7)*43758.5453); }
void main(){
  vec2 p=vec2(vUv.x*uAspect, vUv.y);
  vec3 col=mix(vec3(.0015,.0025,.008), vec3(.006,.012,.035), smoothstep(1.1,.0,length(vUv-vec2(.45,.55))));
  for(int i=0;i<46;i++){
    float fi=float(i);
    vec2 c=vec2(h(fi)*uAspect*1.1-.05, h(fi+.37)*1.15-.07);
    float r=mix(.035,.17,pow(h(fi+.71),2.2));
    float d=length(p-c)/r;
    float disc=smoothstep(1.,.93,d);
    float rim=smoothstep(.80,.97,d)*disc;
    float k=h(fi+.13);
    vec3 tint = k<.68 ? vec3(.10,.24,1.) : k<.82 ? vec3(.12,.50,1.) : k<.93 ? vec3(.24,.18,.90) : vec3(.70,.82,1.);
    float b=mix(.04,.42,pow(h(fi+.91),2.2))*(1.-r*2.3);
    col+=tint*b*(disc*.8+rim*.3);
  }
  col+=vec3(.002,.004,.012)*smoothstep(.0,1.,vUv.y);
  gl_FragColor=vec4(col,1.);
}`;
const bg = new THREE.WebGLRenderTarget(2048, 1152, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType });
gl.setRenderTarget(bg);
gl.render(quad(new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: bokehFrag, uniforms: { uAspect: { value: W / H }, uSeed: { value: SEED } } })), cam);
gl.setRenderTarget(null);

// ---------------------------------------------------------------- pass 2: water on glass (original shader)
const glassFrag = /* glsl */`
varying vec2 vUv; uniform sampler2D tBg; uniform float uT, uLoop, uAspect, uGrain;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
// irregular drop: returns (normal.xy, mask, rimDarkness)
vec4 drop(vec2 d, float size, float seed){
  float a=atan(d.y,d.x);
  float wob=1.+.045*sin(2.*a+seed*6.)+.03*sin(3.*a+seed*13.)+.015*sin(5.*a+seed*3.);
  float r=length(d)/(size*wob);
  float m=smoothstep(1.,.88,r);
  vec2 n=d/(size*wob);
  return vec4(n*m, m, smoothstep(.62,1.,r)*m);
}
// static drops: appear (a new drop lands) and slowly evaporate; integer cycles per loop => seamless
vec4 staticLayer(vec2 uv, float sc, float seed, float density){
  vec2 g=uv*vec2(sc*uAspect,sc); vec2 id=floor(g); vec2 f=fract(g)-.5;
  vec4 acc=vec4(0.);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 o=vec2(i,j); vec2 cid=id+o;
    float r1=h21(cid+seed), r2=h21(cid+seed+1.7), r3=h21(cid+seed+3.3);
    if(h21(cid+seed+9.4)>density) continue;
    vec2 c=o+(vec2(r1,r2)-.5)*.8; float size=mix(.16,.48,r3*r3);
    float k=1.+floor(h21(cid+seed+5.1)*2.); float life=fract(uT/uLoop*k+h21(cid+seed+7.9));
    float s=size*(.55+.45*smoothstep(1.,.25,life))*step(.02,life);
    vec4 dr=drop((f-c)*vec2(1.,1.08), s, r1);
    if(dr.z>acc.z) acc=dr;
  }
  return acc;
}
// big drops sliding down + trail of tiny droplets + a cleared streak
vec4 slideLayer(vec2 uv, float cols, float seed, out float clear){
  vec2 p=vec2(uv.x*uAspect*cols, uv.y); float id=floor(p.x); float fx=fract(p.x)-.5;
  float r1=h21(vec2(id,seed)), r2=h21(vec2(id,seed+2.)), r3=h21(vec2(id,seed+4.));
  clear=0.;
  if(r3<.38) return vec4(0.);
  float k=1.+floor(r2*2.); float head=1.2-fract(uT/uLoop*k+r1)*1.45;
  float wob=sin(p.y*7.+r1*30.)*.17+sin(p.y*19.+r2*10.)*.05;
  float x=fx-wob; float dy=(p.y-head)*cols;
  vec4 big=drop(vec2(x,dy*.8), .18, r2);
  float above=p.y-head;
  clear=smoothstep(.10,.03,abs(x))*smoothstep(0.,.03,above)*smoothstep(.6,.0,above);
  float ty=fract(p.y*cols*2.2+r2); vec2 tid=vec2(id, floor(p.y*cols*2.2+r2));
  float show=step(.45,h21(tid+seed))*smoothstep(0.,.03,above)*smoothstep(.5,.05,above);
  vec4 tiny=drop(vec2(x+(h21(tid)-.5)*.12,(ty-.5)*.45), .07+.04*h21(tid+1.), r1)*show;
  return big.z>tiny.z ? big : tiny;
}
vec3 bgAt(vec2 uv, float lod){ return textureLod(tBg, clamp(uv,0.,1.), lod).rgb; }
void main(){
  vec2 uv=vUv;
  vec4 d1=staticLayer(uv,7.,1.,.45), d2=staticLayer(uv,15.,7.,.5), d3=staticLayer(uv,34.,13.,.42), d4=staticLayer(uv,80.,21.,.3);
  float c1,c2,c3; vec4 s1=slideLayer(uv,3.2,3.,c1), s2=slideLayer(uv,6.,11.,c2), s3=slideLayer(uv,10.,17.,c3);
  // pick the dominant drop at this pixel (front-most = largest mask)
  vec4 D=d4; if(d3.z>D.z) D=d3; if(d2.z>D.z) D=d2; if(d1.z>D.z) D=d1; if(s3.z>D.z) D=s3; if(s2.z>D.z) D=s2; if(s1.z>D.z) D=s1;
  float m=D.z; vec2 n=D.xy; float clear=max(max(c1,c2*.8),c3*.6);
  // glass with a light mist: background slightly hazy except in cleared trails
  vec3 base=bgAt(uv, mix(2.2,1.2,clear));
  base=mix(base, base*.9+vec3(.003,.006,.016), .45*(1.-clear));
  // inside a drop: inverted, magnified, sharper view of the lights + dark refraction rim + speculars
  vec3 lens=bgAt(uv - n*.26, .2)*1.7+vec3(.004,.008,.022);
  float nl=length(n);
  vec3 col=mix(base, lens, m);
  col*=1.-.9*D.w;                                           // dark edge (total internal reflection)
  float spec=smoothstep(.90,.995,dot(normalize(n+1e-5),normalize(vec2(-.55,.75))))*smoothstep(.45,.62,nl)*smoothstep(.85,.7,nl)*m;
  col+=vec3(.8,.9,1.)*spec*.8;                           // main glint
  float caus=smoothstep(.6,.95,dot(normalize(n+1e-5),normalize(vec2(.3,-.95))))*smoothstep(.45,.85,nl)*m;
  col+=vec3(.25,.45,1.)*caus*.22;                          // blue caustic on the lower edge
  // vignette + film grain
  col*=mix(.55,1.,smoothstep(1.2,.35,length((uv-.5)*vec2(1.3,1.))));
  col+=(fract(sin(dot(uv*1000.+uGrain,vec2(12.9898,78.233)))*43758.5453)-.5)*.02;
  gl_FragColor=vec4(col,1.);
  #include <colorspace_fragment>
}`;
const glassMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: glassFrag, uniforms: { tBg: { value: bg.texture }, uT: { value: 0 }, uLoop: { value: LOOP }, uAspect: { value: W / H }, uGrain: { value: 0 } } });
const main = quad(glassMat);

window.renderAt = (t) => {
  const ph = ((t % LOOP) + LOOP) % LOOP;
  glassMat.uniforms.uT.value = ph; glassMat.uniforms.uGrain.value = (ph * 13.37) % 50;
  gl.render(main, cam);
  return gl.domElement.toDataURL('image/jpeg', 0.95);
};
window.ready = true;
