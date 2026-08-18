/**
 * CatCoat.ts — the tiger's material set, generated at load time.
 *
 * ## What this replaces, and why
 *
 * The cat's pattern used to live in its **vertex colours**. That was the right
 * first move — it put the stripes *on* the surface instead of hovering above it
 * — but it caps the pattern's resolution at the mesh's: a body of forty-four
 * sections by twenty-eight segments has about a thousand colour samples to spend
 * on an animal two metres long, so every stripe edge is a centimetre of blur and
 * the coat has no detail between the vertices at all. Close up it reads as an
 * airbrushed model.
 *
 * A game asset solves this with texture maps, and so does this — the difference
 * being that there is nowhere in this project to put a .png, so the maps are
 * *drawn* at start-up instead of loaded:
 *
 *  • **base colour** — counter-shading, the stripe pattern, and fur grain, at
 *    a megapixel instead of a thousand vertices;
 *  • **normal** — derived from the same grain height field, so the light breaks
 *    up along individual hairs rather than sliding over a smooth shell;
 *  • **roughness** — fur is not uniformly rough, and the variation is what makes
 *    a lit flank look like hair instead of like rubber;
 *  • **ambient occlusion** — the creases (behind the shoulder, the groin, under
 *    the jaw) darkened, which is the cheapest depth cue there is.
 *
 * All four come out of one per-pixel pass, so they agree with each other by
 * construction: the hair that darkens the base colour is the hair that tilts the
 * normal and roughens the surface.
 *
 * The lofted parts hand us a natural parameterisation — `u` along the part and
 * `v` around it, with the spine at v=0 and v=1 and the belly at v=0.5 — so the
 * maps are drawn in that space directly and no UV unwrapping is needed.
 */

import * as THREE from 'three';

/** Deterministic hash in 0..1: the same tiger every time the game starts. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth value noise, used for fur grain and for mottling the coat. */
function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi * 157.1 + yi * 311.7 + seed);
  const b = hash((xi + 1) * 157.1 + yi * 311.7 + seed);
  const c = hash(xi * 157.1 + (yi + 1) * 311.7 + seed);
  const d = hash((xi + 1) * 157.1 + (yi + 1) * 311.7 + seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

/** One stripe: where it sits, how wide it is, how far it reaches, and its fork. */
interface Band {
  centre: number;
  width: number;
  lean: number;
  reach: number;
  fork: number;
  forkAt: number;
}

/**
 * The stripe layout for one part of the animal.
 *
 * Everything that stops a striped animal looking printed is in here, and all of
 * it is visible in a photograph of a real tiger: the bands are **unevenly
 * spaced**, they **vary in width**, they **lean backwards as they descend** the
 * flank, they **stop at different heights**, and about a third of them **fork**
 * partway down. Regular bands of one width read as a barcode from any distance.
 */
function bands(count: number, seed: number): Band[] {
  const out: Band[] = [];
  for (let k = 0; k < count; k++) {
    const j = hash(k * 3.7 + seed);
    const j2 = hash(k * 8.1 + seed * 2.3);
    const j3 = hash(k * 12.9 + seed * 5.1);
    out.push({
      centre: (k + 0.5) / count + (j - 0.5) * 0.6 / count,
      width: (0.05 + j * 0.1) / count,
      lean: 0.05 + j2 * 0.1,
      // How far down the flank this band runs: some reach the belly, some die
      // out over the ribs.
      reach: 0.3 + j3 * 0.72,
      fork: j2 > 0.58 ? 0.055 + j * 0.05 : 0,
      forkAt: 0.4 + j3 * 0.22,
    });
  }
  return out;
}

/** Coverage of the stripe pattern at a point, 0..1 with a soft edge. */
function stripeAt(list: Band[], along: number, down: number): number {
  let value = 0;
  for (const b of list) {
    if (down > b.reach) continue;
    const centre = b.centre + down * b.lean;
    let d = Math.abs(along - centre) / b.width;
    if (b.fork > 0 && down > b.forkAt) {
      const branch = centre + (down - b.forkAt) * b.fork;
      d = Math.min(d, Math.abs(along - branch) / (b.width * 0.75));
    }
    // Taper: a band narrows as it approaches the end of its reach, and fades
    // out over the white of the belly.
    const taper = 1 - Math.pow(Math.min(1, down / Math.max(0.05, b.reach)), 6);
    const edge = 1 - Math.max(0, Math.min(1, (d - 0.62) / 0.38));
    value = Math.max(value, edge * edge * (3 - 2 * edge) * taper);
  }
  return Math.min(1, value * 1.35);
}

/** Rosettes, for the spotted cats that share this anatomy. */
function rosetteAt(along: number, down: number, seed: number): number {
  let value = 0;
  for (let row = 0; row < 6; row++) {
    for (let i = 0; i < 11; i++) {
      const j = hash(row * 17.3 + i * 5.1 + seed);
      const cx = (i + (row % 2) * 0.5 + (j - 0.5) * 0.5) / 11;
      const cy = 0.1 + row * 0.16 + (j - 0.5) * 0.07;
      const dx = (along - cx) / 0.045;
      const dy = (down - cy) / 0.085;
      const r = Math.sqrt(dx * dx + dy * dy);
      // An open ring of broken marks, not a disc.
      const ring = 1 - Math.min(1, Math.abs(r - 0.75) * 3.4);
      const gap = hash(row * 3.1 + i * 9.7 + Math.floor(Math.atan2(dy, dx) * 2.4) + seed);
      value = Math.max(value, ring * (gap > 0.25 ? 1 : 0.25) * (1 - Math.max(0, (down - 0.78) / 0.22)));
    }
  }
  return Math.min(1, value);
}

// ---------------------------------------------------------------------------
// The maps
// ---------------------------------------------------------------------------

/** Which part of the animal a map is for. They differ in scale and pattern. */
export type CoatPart = 'body' | 'limb' | 'head' | 'tail';

export interface CoatMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
}

export interface CoatSpec {
  /** Coat tone along the spine, on the flank, and under the belly. */
  back: [number, number, number];
  flank: [number, number, number];
  belly: [number, number, number];
  marking: [number, number, number];
  pattern: 'stripes' | 'rosettes';
  seed: number;
}

const cache = new Map<string, CoatMaps | null>();

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Draw the four maps for one part.
 *
 * One pass over the pixels fills all of them, which is the point: the hair that
 * darkens the colour is the hair that tilts the normal, so the surface and its
 * shading cannot disagree.
 */
export function coatMaps(spec: CoatSpec, part: CoatPart, key: string): CoatMaps | null {
  const cacheKey = `${key}:${part}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') {
    cache.set(cacheKey, null);
    return null;
  }

  /*
   * Resolution follows how much of the screen the part can fill. The body is
   * the one a player stands next to; a tail is a tube a hand's width across.
   */
  const size: Record<CoatPart, [number, number]> = {
    body: [1024, 512],
    limb: [256, 256],
    head: [512, 384],
    tail: [512, 128],
  };
  const [w, h] = size[part];

  const colourCanvas = document.createElement('canvas');
  colourCanvas.width = w;
  colourCanvas.height = h;
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = w;
  aoCanvas.height = h;
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = w;
  normalCanvas.height = h;

  const colour = new ImageData(w, h);
  const rough = new ImageData(w, h);
  const ao = new ImageData(w, h);
  const height = new Float32Array(w * h);

  const stripes = spec.pattern === 'stripes';
  const list = bands(part === 'body' ? 23 : part === 'head' ? 10 : part === 'tail' ? 13 : 9, spec.seed);

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    // The lofts wrap the spine at v=0 and v=1 with the belly at v=0.5, so
    // "how far down the animal" is a fold of v — and both flanks get the same
    // treatment without drawing them twice.
    const down = v <= 0.5 ? v * 2 : (1 - v) * 2;
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const i = (y * w + x) * 4;

      /*
       * ## Fur grain
       *
       * Two octaves, both stretched hard along u. Hair lies along the body, so
       * the noise has to be long in that direction and short across it — round
       * noise reads as dirt, not as a coat. The fine octave is the individual
       * hairs; the coarse one is the clumping that fur falls into.
       */
      const fine = noise2(u * 220, v * 900, spec.seed);
      const clump = noise2(u * 26, v * 120, spec.seed + 17);
      const grain = fine * 0.62 + clump * 0.38;
      height[y * w + x] = grain;

      // --- Base colour --------------------------------------------------
      /*
       * ## The pale underside is a *narrow* band on a limb
       *
       * The body's gradient runs the full quarter turn from the spine to the
       * belly, which is right for a barrel and wrong for anything else: applied
       * to a leg it painted two fifths of the circumference white, so the legs
       * came out as silver pipes. A tiger's inner leg is a stripe of white, its
       * tail is pale only along the very underside, and its head has its own
       * rules entirely (below).
       */
      let tone: [number, number, number];
      if (part === 'limb' || part === 'tail') {
        const pale = Math.pow(Math.max(0, (down - (part === 'limb' ? 0.72 : 0.86)) / 0.28), 1.3);
        tone = mix(mix(spec.back, spec.flank, Math.min(1, down * 2.2)), spec.belly, pale);
      } else if (down < 0.46) {
        tone = mix(spec.back, spec.flank, down / 0.46);
      } else {
        tone = mix(spec.flank, spec.belly, Math.pow(Math.max(0, (down - 0.5) / 0.44), 1.4));
      }

      let marks = stripes ? stripeAt(list, u, down) : rosetteAt(u, down, spec.seed);

      /*
       * ## The face is its own pattern
       *
       * Folding the body's rules over the head gave a tiger with a striped nose
       * and a grey chin. A tiger's face is specific and it is the part a player
       * looks at: white around the muzzle and the chin, a white patch over each
       * eye, black bars fanning back across the cheeks and up the forehead, and
       * a bridge of the nose that stays orange.
       */
      if (part === 'head') {
        // u runs back-of-skull → nose. The lofts put the muzzle at the far end.
        const muzzle = Math.max(0, (u - 0.66) / 0.34);
        const throat = Math.max(0, (down - 0.72) / 0.28);
        // The white sits low on the front of the face; the nose bridge does not.
        const white = Math.min(1, Math.max(muzzle * Math.min(1, down * 1.7), throat));
        if (white > 0.01) tone = mix(tone, spec.belly, Math.min(1, white * 0.95));
        // Brow patch: a pale blaze above the eye line, both sides.
        const brow = Math.exp(-Math.pow((u - 0.5) / 0.09, 2)) * Math.exp(-Math.pow((down - 0.3) / 0.12, 2));
        if (brow > 0.02) tone = mix(tone, spec.belly, Math.min(0.8, brow));
        // Nothing on the muzzle itself.
        marks *= 1 - Math.min(1, muzzle * 1.5);
      }

      if (marks > 0.004) tone = mix(tone, spec.marking, Math.min(1, marks));

      // Grain darkens and lightens the coat by a few per cent — the same
      // variation that makes real fur look like many hairs and not one skin.
      const shade = 0.88 + grain * 0.24;
      colour.data[i] = Math.min(255, tone[0] * shade);
      colour.data[i + 1] = Math.min(255, tone[1] * shade);
      colour.data[i + 2] = Math.min(255, tone[2] * shade);
      colour.data[i + 3] = 255;

      // --- Roughness ----------------------------------------------------
      /*
       * Fur is rough; the pale belly hair is softer and rougher still; and the
       * short hair over the muzzle and the bridge of the nose is the smoothest
       * part of the animal. The grain modulates all of it, so highlights break
       * up along the hair instead of sitting in a clean band.
       */
      let r = 0.8 + (1 - grain) * 0.14 + down * 0.05;
      if (part === 'head' && u > 0.72) r -= 0.16;
      const rv = Math.max(0, Math.min(255, r * 255));
      rough.data[i] = rv;
      rough.data[i + 1] = rv;
      rough.data[i + 2] = rv;
      rough.data[i + 3] = 255;

      // --- Ambient occlusion --------------------------------------------
      /*
       * Where the light does not reach: the crease behind the shoulder, the
       * groin, the fold where a limb meets the body, and the deep fur along
       * the belly seam. Cheap, and it is what gives a smooth loft the sense of
       * having volume under it.
       */
      let occlusion = 1;
      if (part === 'body') {
        const shoulder = Math.exp(-Math.pow((u - 0.29) / 0.045, 2));
        const groin = Math.exp(-Math.pow((u - 0.78) / 0.05, 2));
        const seam = Math.exp(-Math.pow((down - 1) / 0.16, 2));
        occlusion -= 0.3 * Math.max(shoulder, groin) * Math.min(1, 0.35 + down * 0.9);
        occlusion -= 0.22 * seam;
      } else if (part === 'limb') {
        // Deepest where the limb disappears into the body.
        occlusion -= 0.3 * Math.exp(-Math.pow(u / 0.16, 2));
      } else if (part === 'head') {
        occlusion -= 0.26 * Math.exp(-Math.pow((down - 1) / 0.2, 2));
      }
      occlusion = Math.max(0.35, occlusion - grain * 0.06);
      const av = occlusion * 255;
      ao.data[i] = av;
      ao.data[i + 1] = av;
      ao.data[i + 2] = av;
      ao.data[i + 3] = 255;
    }
  }

  /*
   * The normal map, derived from the grain height field by finite differences.
   *
   * `strength` is scaled by the map's resolution so a hair on the body and a
   * hair on the tail tilt the surface by the same physical amount — otherwise
   * the small maps come out looking varnished and the big ones look like tree
   * bark.
   */
  const normal = new ImageData(w, h);
  const strength = part === 'body' ? 2.6 : 1.9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const xl = height[y * w + ((x - 1 + w) % w)];
      const xr = height[y * w + ((x + 1) % w)];
      const yu = height[((y - 1 + h) % h) * w + x];
      const yd = height[((y + 1) % h) * w + x];
      const nx = (xl - xr) * strength;
      const ny = (yu - yd) * strength;
      const len = Math.hypot(nx, ny, 1);
      normal.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      normal.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      normal.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      normal.data[i + 3] = 255;
    }
  }

  colourCanvas.getContext('2d')!.putImageData(colour, 0, 0);
  roughCanvas.getContext('2d')!.putImageData(rough, 0, 0);
  aoCanvas.getContext('2d')!.putImageData(ao, 0, 0);
  normalCanvas.getContext('2d')!.putImageData(normal, 0, 0);

  const wrap = (canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };

  const maps: CoatMaps = {
    map: wrap(colourCanvas, true),
    normalMap: wrap(normalCanvas, false),
    roughnessMap: wrap(roughCanvas, false),
    aoMap: wrap(aoCanvas, false),
  };
  cache.set(cacheKey, maps);
  return maps;
}

// ---------------------------------------------------------------------------
// Fur shells
// ---------------------------------------------------------------------------

const shellCache = new Map<number, THREE.CanvasTexture | null>();

/**
 * The alpha mask for one shell of fur.
 *
 * ## Why shells rather than strands
 *
 * Strand-based fur — a groom of a hundred thousand curves — is what an offline
 * renderer or a modern engine's hair system does, and there is no honest way to
 * do it here: WebGL2 with no compute shaders, on a page that also has to draw a
 * jungle, for up to forty animals at once.
 *
 * The shell technique is the standard optimisation and it is nearly free: draw
 * the body two or three more times, each copy pushed a few millimetres further
 * out along its normals, each masked by a noise field thresholded harder than
 * the last. What survives to the outermost shell is a scattering of points —
 * read as the *tips* of hairs — and what the eye actually gets is a ragged
 * silhouette and a soft edge, which is the whole of what says "furry" at
 * gameplay distance.
 *
 * `level` is the shell's depth, 0 nearest the skin. Density falls off with it,
 * because a hair is thinner at the tip and not every hair is as long.
 */
function shellAlpha(level: number): THREE.CanvasTexture | null {
  const hit = shellCache.get(level);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') {
    shellCache.set(level, null);
    return null;
  }
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const data = new ImageData(size, size);
  const keep = 0.52 - level * 0.16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Stretched along u like the coat's grain, so the mask reads as hairs
      // lying along the body rather than as static.
      const n = noise2(x / 2.1, y / 12.5, 91) * 0.6 + noise2(x / 9, y / 40, 7) * 0.4;
      const on = n > 1 - keep ? 255 : 0;
      data.data[i] = 255;
      data.data[i + 1] = 255;
      data.data[i + 2] = 255;
      data.data[i + 3] = on;
    }
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  shellCache.set(level, texture);
  return texture;
}

/**
 * A fur shell over a part: the same surface, pushed out and mostly cut away.
 *
 * Alpha *test* rather than blending, deliberately. Blended shells need sorting,
 * fight the depth buffer and cost fill rate three times over; a cut-out shell is
 * an opaque draw with a hole in it, needs no sorting, and casts a ragged shadow
 * — which is itself one of the cues that the outline is hair.
 */
export function furShell(
  source: THREE.BufferGeometry,
  offset: number,
  level: number,
  maps: CoatMaps | null,
): THREE.Mesh | null {
  const alpha = shellAlpha(level);
  if (!alpha) return null;

  const geometry = source.clone();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  if (!normal) return null;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) + normal.getX(i) * offset,
      position.getY(i) + normal.getY(i) * offset,
      position.getZ(i) + normal.getZ(i) * offset,
    );
  }
  position.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    alphaMap: alpha,
    alphaTest: 0.5,
    roughness: 0.95,
    metalness: 0,
    // The tips of hair catch light from behind, so a shell is lit on both faces.
    side: THREE.DoubleSide,
  });
  if (maps) {
    material.map = maps.map;
    material.normalMap = maps.normalMap;
  } else {
    material.vertexColors = true;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// The eye
// ---------------------------------------------------------------------------

const irisCache = new Map<number, THREE.CanvasTexture | null>();

/**
 * An iris: radial fibres round a dark limbal ring.
 *
 * An eye is the one part of an animal a player looks *at* rather than past, and
 * a flat disc of amber is the difference between an animal and a doll. The
 * fibres are what make it read as an iris — they catch the light unevenly as the
 * head turns, which is exactly what a real one does.
 */
export function irisTexture(colour: number): THREE.CanvasTexture | null {
  const hit = irisCache.get(colour);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') {
    irisCache.set(colour, null);
    return null;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;

  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, size, size);
  // Fibres, radiating from the pupil.
  ctx.translate(size / 2, size / 2);
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2 + hash(i) * 0.03;
    const shade = 0.55 + hash(i * 7.3) * 0.75;
    ctx.strokeStyle = `rgba(${r * shade},${g * shade},${b * shade},0.85)`;
    ctx.lineWidth = 1 + hash(i * 3.1) * 2.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * size * 0.13, Math.sin(a) * size * 0.13);
    ctx.lineTo(Math.cos(a) * size * 0.5, Math.sin(a) * size * 0.5);
    ctx.stroke();
  }
  // The limbal ring: every eye has a dark edge, and its absence is uncanny.
  ctx.strokeStyle = 'rgba(20,12,6,0.85)';
  ctx.lineWidth = size * 0.09;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.455, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  irisCache.set(colour, texture);
  return texture;
}

/** Free the generated textures (used when tearing the renderer down). */
export function disposeCoatCaches(): void {
  for (const maps of cache.values()) {
    if (!maps) continue;
    maps.map.dispose();
    maps.normalMap.dispose();
    maps.roughnessMap.dispose();
    maps.aoMap.dispose();
  }
  cache.clear();
  for (const t of shellCache.values()) t?.dispose();
  shellCache.clear();
  for (const t of irisCache.values()) t?.dispose();
  irisCache.clear();
}
