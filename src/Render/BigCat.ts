/**
 * BigCat.ts — the tiger, and the three cats that share its anatomy.
 *
 * ## Why this is not the quadruped builder
 *
 * `buildQuadruped` makes an animal out of overlapping ellipsoids: a barrel, a
 * chest, a rump, four capsule legs, a ball for a skull. It is a good way to get
 * twelve species out of one function and a bad way to get *one* species right.
 * Everything the reference photograph of a tiger shows that the old model did
 * not, it failed to show for the same structural reason — the shape is a union
 * of blobs:
 *
 *  • **Segmentation.** Three overlapping ellipsoids meet in two visible seams,
 *    and no amount of overlap hides them once the light comes from the side.
 *    A tiger's back is one continuous line from the shoulder to the tail.
 *  • **No taper, no muscle.** A capsule leg is the same thickness at the elbow
 *    as at the wrist. A big cat's foreleg is as thick as its own head at the top
 *    and half that at the ankle, and that difference *is* the animal's power.
 *  • **Markings that fight the surface.** Stripes painted as separate flattened
 *    meshes have to hover above the skin, so they z-fight, break at the seams,
 *    and cannot follow the body round a curve.
 *
 * So this builds the cat the way a modelled animal is built: a **loft**. A spine
 * of stations, each with a cross-section measured off the reference — deep chest,
 * tucked waist, high haunch — skinned into one continuous surface. Legs are
 * lofted too, tapering from a heavy shoulder to a narrow ankle, and every one of
 * them is a two-segment limb the animator can already drive.
 *
 * And the coat is **in the mesh**. Every vertex knows where it is on the animal,
 * so the colour it gets is computed there: dark along the spine, orange down the
 * flank, white under the belly, with the stripe pattern evaluated as a function
 * of position. The stripes wrap the body exactly because they are the body.
 * They cost no geometry, no draw calls, and cannot come unstuck.
 */

import * as THREE from 'three';
import { Species, type AnimalDef } from '../Animals/AnimalTypes';
import { loft, resample, type Station } from './Loft';
import {
  coatMaps,
  furShell,
  irisTexture,
  type CoatPart,
  type CoatSpec,
} from './CatCoat';

// ---------------------------------------------------------------------------
// The coat
// ---------------------------------------------------------------------------

/**
 * The coat material for one part of the animal.
 *
 * ## Textures, not vertex colours
 *
 * The pattern used to be painted into the mesh's vertices. That put it *on* the
 * surface, which was the important thing, but a body of forty-four sections has
 * only about a thousand colour samples to spend on a two-metre animal — every
 * stripe edge was a centimetre of blur, and there was no detail at all between
 * one vertex and the next.
 *
 * Each part now wears a generated PBR set instead: base colour, normal,
 * roughness and ambient occlusion, drawn at load time in the part's own natural
 * parameterisation (see CatCoat.ts). The vertex colours stay as the fallback,
 * for the headless tools where there is no canvas to draw into — and they are
 * still what the paws and toes use, being too small to be worth a map.
 *
 * `envMapIntensity` is deliberately low. Fur is not shiny; what a little
 * environment light does is keep the shadow side from going flat black, which is
 * the other half of what makes a model look like plastic.
 */
const coatMaterials = new Map<string, THREE.Material>();

function coat(spec: CoatSpec, part: CoatPart, key: string): THREE.Material {
  const cacheKey = `${key}:${part}`;
  const hit = coatMaterials.get(cacheKey);
  if (hit) return hit;

  const material = new THREE.MeshStandardMaterial({
    metalness: 0,
    roughness: 0.86,
    envMapIntensity: 0.25,
  });
  const maps = coatMaps(spec, part, key);
  if (maps) {
    material.map = maps.map;
    material.normalMap = maps.normalMap;
    // Hair is fine, so the normal detail is left strong across the coat and
    // eased off a little only where the map is stretched over a small part.
    material.normalScale = new THREE.Vector2(part === 'body' ? 1 : 0.75, part === 'body' ? 1 : 0.75);
    material.roughnessMap = maps.roughnessMap;
    material.aoMap = maps.aoMap;
    material.aoMapIntensity = 0.9;
  } else {
    material.vertexColors = true;
  }
  coatMaterials.set(cacheKey, material);
  return material;
}

/** True when the generated maps are available, so parts can skip vertex paint. */
function textured(spec: CoatSpec, key: string): boolean {
  return coatMaps(spec, 'body', key) !== null;
}

/** Glossy, for eyes and a wet nose. */
const glossCache = new Map<number, THREE.MeshPhongMaterial>();
function gloss(color: number): THREE.MeshPhongMaterial {
  let m = glossCache.get(color);
  if (!m) {
    m = new THREE.MeshPhongMaterial({ color, shininess: 110, specular: 0x999999 });
    glossCache.set(color, m);
  }
  return m;
}

/** Plain matte, for claws and teeth where a vertex-coloured mesh is overkill. */
const flatCache = new Map<number, THREE.MeshStandardMaterial>();
function flat(color: number, roughness = 0.7): THREE.MeshStandardMaterial {
  const key = color * 100 + Math.round(roughness * 10);
  let m = flatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    flatCache.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

/** Deterministic hash in 0..1, so every tiger of a species is the same tiger. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

interface Coat {
  /** Coat colour along the spine, on the flank, and under the belly. */
  back: THREE.Color;
  flank: THREE.Color;
  belly: THREE.Color;
  marking: THREE.Color;
  pattern: 'stripes' | 'rosettes';
}

function coatOf(def: AnimalDef): Coat {
  const c = def.silhouette.colors;
  const stripes = def.species === Species.Tiger;
  return {
    /*
     * Three tones, not one. In the photograph the spine is a deep rust, the
     * flank a bright orange and the belly white, and the transitions are wide
     * gradients — a single body colour with a pale patch bolted under it is the
     * thing that makes a model look painted.
     */
    back: new THREE.Color(stripes ? 0xa8531a : shade(c.body, 0.8)),
    flank: new THREE.Color(stripes ? 0xd9812f : c.body),
    belly: new THREE.Color(stripes ? 0xf2ece2 : c.belly),
    marking: new THREE.Color(stripes ? 0x120e0b : c.accent),
    pattern: stripes ? 'stripes' : 'rosettes',
  };
}

function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/**
 * The palette, as the texture generator wants it.
 *
 * Three coat tones and a marking colour, in plain 0..255 triples because the
 * maps are drawn into a canvas and mixed in that space. The tiger's values are
 * read off the reference photograph: a deep rust along the spine, a bright
 * orange flank, and a belly that is genuinely white rather than cream.
 */
function coatSpec(def: AnimalDef): CoatSpec {
  const c = def.silhouette.colors;
  const stripes = def.species === Species.Tiger;
  const rgb = (hex: number): [number, number, number] => [
    (hex >> 16) & 0xff,
    (hex >> 8) & 0xff,
    hex & 0xff,
  ];
  return {
    back: rgb(stripes ? 0xa8531a : shade(c.body, 0.8)),
    flank: rgb(stripes ? 0xd9812f : c.body),
    belly: rgb(stripes ? 0xf4efe6 : c.belly),
    marking: rgb(stripes ? 0x120e0b : c.accent),
    pattern: stripes ? 'stripes' : 'rosettes',
    seed: stripes ? 3 : 11,
  };
}

/**
 * The stripe field.
 *
 * `along` is 0 at the shoulder and 1 at the rump; `down` is 0 along the spine
 * and 1 at the belly line. Returns 1 inside a stripe and 0 outside, with a soft
 * edge — fur has no hard boundary and a hard one reads as paint.
 *
 * ## What makes it look like a tiger and not like a barcode
 *
 * Three things, all visible in the reference photograph and all absent from a
 * regular pattern: the bands are **irregularly spaced and of different widths**;
 * they **lean backwards as they descend** the flank; and about a third of them
 * **fork** partway down. The fork is the detail that does most of the work —
 * without it the eye reads a repeating pattern and stops believing it.
 */
function stripeField(along: number, down: number, count: number, seed: number): number {
  let value = 0;
  for (let k = 0; k < count; k++) {
    const j = hash(k * 3.7 + seed);
    const j2 = hash(k * 8.1 + seed * 2.3);
    // Irregular spacing: a jitter of up to a third of the gap between bands.
    const centre = (k + 0.5) / count + (j - 0.5) * 0.55 / count;
    // Lean: the band trails backwards as it goes down the flank.
    const lean = centre + down * (0.035 + j2 * 0.05);
    const width = (0.17 + j * 0.16) / count;
    let d = Math.abs(along - lean) / width;

    // The second limb of a forked band, peeling off below the midline.
    if (j2 > 0.62 && down > 0.42) {
      const branch = lean + (down - 0.42) * (0.09 + j * 0.05);
      d = Math.min(d, Math.abs(along - branch) / (width * 0.72));
    }
    // Bands thin out and stop as they reach the white underside.
    const fade = 1 - Math.max(0, (down - 0.86) / 0.14);
    // Smoothstep rather than a squared falloff: a stripe has a soft edge about
    // a hair's width across, not a gradient half its own width.
    const edge = 1 - Math.max(0, Math.min(1, (d - 0.55) / 0.45));
    value = Math.max(value, edge * edge * (3 - 2 * edge) * fade);
  }
  return Math.min(1, value * 1.45);
}

/** Rosettes, for the spotted cats sharing this anatomy. */
function rosetteField(along: number, down: number, seed: number): number {
  let value = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 9; i++) {
      const j = hash(row * 17.3 + i * 5.1 + seed);
      const cx = (i + (row % 2) * 0.5 + (j - 0.5) * 0.5) / 9;
      const cy = 0.12 + row * 0.19 + (j - 0.5) * 0.08;
      const dx = (along - cx) / 0.055;
      const dy = (down - cy) / 0.1;
      const r = Math.sqrt(dx * dx + dy * dy);
      // A ring, not a disc: a rosette is an open circle of broken marks.
      const ring = 1 - Math.min(1, Math.abs(r - 0.8) * 2.6);
      value = Math.max(value, ring * (1 - Math.max(0, (down - 0.8) / 0.2)));
    }
  }
  return Math.min(1, value);
}

/**
 * The colour of one point on the coat.
 *
 * `down` runs 0 (spine) to 1 (belly). The gradient between the three tones is
 * deliberately wide and the white does not start until well under the flank,
 * because on a real cat the pale underside is only visible from below or in
 * profile at the very bottom of the barrel.
 */
function coatColour(
  out: THREE.Color,
  coatDef: Coat,
  along: number,
  down: number,
  markings: number,
  seed: number,
): THREE.Color {
  if (down < 0.5) {
    out.copy(coatDef.back).lerp(coatDef.flank, Math.min(1, down / 0.5));
  } else {
    out.copy(coatDef.flank).lerp(coatDef.belly, Math.pow(Math.max(0, (down - 0.52) / 0.42), 1.5));
  }
  // Fine mottling, so no two square centimetres of flank are the same tone.
  const grain = (hash(along * 91.7 + down * 57.3 + seed) - 0.5) * 0.07;
  out.offsetHSL(0, 0, grain);
  if (markings > 0.02) out.lerp(coatDef.marking, Math.min(1, markings));
  return out;
}

// ---------------------------------------------------------------------------
// Lofting
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The cat
// ---------------------------------------------------------------------------


/**
 * Roll a lofted part's UVs around its axis.
 *
 * The coat maps are drawn once, with the pale underside at v = 0.5; a limb needs
 * that band on its *inner* face, which is a quarter turn away and in opposite
 * directions on the two sides of the animal. Shifting the attribute is free —
 * the textures wrap — and it means one map serves all four legs.
 */
function rollUv(geometry: THREE.BufferGeometry, amount: number): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) + amount);
  uv.needsUpdate = true;
}

/** What the builder reports back, in the shape the animator already drives. */
export interface BigCatParts {
  body: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Object3D;
  legs: THREE.Object3D[];
  knees: THREE.Object3D[];
  /** The third joint, so a paw can stay flat while the leg swings over it. */
  ankles: THREE.Object3D[];
  ears: THREE.Object3D[];
  tail: THREE.Object3D[];
}

/**
 * Build a tiger — or a leopard, jaguar, ocelot, which are the same animal in a
 * different coat.
 *
 * ## The proportions, and where they come from
 *
 * Every number below is stated as a fraction of the animal's **shoulder
 * height**, not of the silhouette box, because that is how a photograph can be
 * measured and because the box's "length" includes a head and a neck. Off the
 * reference, for a cat standing 0.95 m at the shoulder:
 *
 *   • the barrel — shoulder to hip — is about one shoulder height long, so the
 *     cat is *not* the dachshund that comes out of using the full body length;
 *   • the chest is deepest just behind the elbow, and hangs almost twice as far
 *     below the spine as the back rises above it;
 *   • the waist is visibly tucked, both narrower and shallower than the ribs,
 *     and that tuck is what makes the hind quarters read as separate power;
 *   • the haunch is the widest part of the animal seen from above;
 *   • the head is carried level with the withers, not above them;
 *   • the foreleg is thicker than the hind leg below the knee and thinner above
 *     it, because the mass in a hind leg is all in the thigh;
 *   • the tail is a shade longer than the barrel.
 */
export function buildBigCat(root: THREE.Group, def: AnimalDef, detail: number): BigCatParts {
  const s = def.silhouette;
  const H = s.height;
  const c = coatOf(def);
  const seed = def.species === Species.Tiger ? 3 : 11;
  /*
   * Three tiers. `fine` is the animal you are standing next to; `mid` is the
   * one across the clearing, which keeps the anatomy and the coat but drops the
   * parts that are smaller than a pixel at that range; neither is the crude
   * shape used past sixty metres.
   */
  const fine = detail >= 0.9;
  const mid = detail >= 0.5;
  /*
   * One material per part, each wearing its own generated PBR set. Four
   * materials rather than one costs three extra draw calls and buys a megapixel
   * of pattern where a thousand vertices used to carry it.
   */
  const spec = coatSpec(def);
  const coatKey = String(def.species);
  const material = coat(spec, 'body', coatKey);
  const limbMaterial = coat(spec, 'limb', coatKey);
  const headMaterial = coat(spec, 'head', coatKey);
  const tailMaterial = coat(spec, 'tail', coatKey);
  const mapped = textured(spec, coatKey);
  /*
   * Paws and toes keep their vertex paint: they are spheres a few centimetres
   * across, where a texture would be stretched over four triangles and a solid
   * tone is indistinguishable from one.
   */
  const pawMaterial = (() => {
    if (!mapped) {
      // No canvas (the headless tools): fall back to the vertex paint.
      const m = flat(0xfffffe, 0.88);
      m.vertexColors = true;
      return m;
    }
    // A plain tone taken from the coat's own flank, darkened a little because a
    // paw is in its own shadow most of the time.
    const [r, g, b] = spec.flank;
    return flat(((r * 0.82) << 16) | ((g * 0.82) << 8) | (b * 0.82), 0.9);
  })();

  /** Barrel length, shoulder to hip. Everything else hangs off this. */
  const bl = H * 1.05;

  const body = new THREE.Group();
  body.position.y = H * 0.62;
  root.add(body);

  // --- Barrel -------------------------------------------------------------
  const key: Station[] = [
    // The front of the chest, under the base of the neck. Wide: on a big cat
    // the shoulder is the *front* of the barrel, and starting narrow here is
    // what made the first pass read as a long-necked greyhound.
    { x: bl * 0.5, y: H * 0.03, up: H * 0.155, down: H * 0.205, half: H * 0.185 },
    // Withers: the high point of the back on a walking cat.
    { x: bl * 0.36, y: H * 0.04, up: H * 0.18, down: H * 0.24, half: H * 0.205 },
    // Deepest chest, just behind the elbow, and nearly as wide as the haunch.
    { x: bl * 0.17, y: H * 0.015, up: H * 0.17, down: H * 0.275, half: H * 0.21 },
    // Waist: tucked, and the narrowest section of the body.
    { x: -bl * 0.05, y: 0, up: H * 0.15, down: H * 0.195, half: H * 0.165 },
    // Loin, filling out again towards the hips.
    { x: -bl * 0.24, y: H * 0.014, up: H * 0.163, down: H * 0.19, half: H * 0.185 },
    // Haunch: the widest part of the animal from above.
    { x: -bl * 0.4, y: H * 0.032, up: H * 0.178, down: H * 0.195, half: H * 0.205 },
    // Rump, rounding off to the tail.
    { x: -bl * 0.53, y: H * 0.02, up: H * 0.12, down: H * 0.125, half: H * 0.13 },
  ];
  const barrel = new THREE.Mesh(
    loft(resample(key, fine ? 44 : mid ? 26 : 11), fine ? 28 : mid ? 16 : 9, (along, down, _lateral, at, out) => {
      const marks =
        c.pattern === 'stripes'
          ? stripeField(along, down, 15, seed)
          : rosetteField(along, down, seed);
      coatColour(out, c, along, down, marks, seed + at);
    }),
    material,
  );
  barrel.castShadow = true;
  body.add(barrel);

  /*
   * ## Fur
   *
   * Two shells over the barrel: the same surface pushed a few millimetres out
   * along its normals, cut away by a thresholded noise mask so what is left
   * reads as the tips of hairs. See CatCoat.furShell for why this rather than a
   * strand groom — in one line, WebGL2 with no compute shaders, forty animals,
   * and a jungle to draw as well.
   *
   * What it buys is the *silhouette*. A smooth loft has a mathematically clean
   * outline, and a clean outline is the single loudest signal that something is
   * a model rather than an animal; a ragged one is what says "fur" from thirty
   * metres, long before any texture detail is resolvable.
   *
   * LOD0 only. At the mid tier the shells are gone and the coat is carried by
   * the normal map alone.
   */
  if (detail >= 1) {
    const shellMaps = coatMaps(spec, 'body', coatKey);
    for (let level = 0; level < 2; level++) {
      const shell = furShell(barrel.geometry, H * (0.006 + level * 0.007), level, shellMaps);
      if (shell) body.add(shell);
    }
  }

  // --- Neck ---------------------------------------------------------------
  /*
   * Short, thick, and carried *forward* rather than up. A big cat's neck is
   * about as thick as its own skull, and the line from the withers to the ears
   * is nearly level — a neck angled up like a dog's is the fastest way to make
   * a cat look like something else.
   */
  const neck = new THREE.Mesh(
    loft(
      resample(
        [
          { x: bl * 0.4, y: H * 0.03, up: H * 0.16, down: H * 0.185, half: H * 0.17 },
          { x: bl * 0.5, y: H * 0.05, up: H * 0.165, down: H * 0.17, half: H * 0.172 },
          { x: bl * 0.58, y: H * 0.065, up: H * 0.16, down: H * 0.15, half: H * 0.165 },
        ],
        fine ? 12 : mid ? 8 : 6,
      ),
      fine ? 20 : mid ? 14 : 10,
      (along, down, _lateral, at, out) => {
        const marks = c.pattern === 'stripes' ? stripeField(along * 0.14, down, 15, seed + 5) : 0;
        coatColour(out, c, 0.04, down, marks, seed + at);
      },
    ),
    headMaterial,
  );
  neck.castShadow = true;
  body.add(neck);

  // --- Head ---------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(bl * 0.6, H * 0.08, 0);
  body.add(head);
  const skullLen = H * 0.42;
  const skullW = H * 0.31;

  /*
   * The skull.
   *
   * A tiger's head is nearly as wide as it is long and the muzzle is *short* —
   * a fifth of the head's length, blunt at the end. The widest point is the
   * cheek, well below and behind the eye, where the jaw muscle and the ruff
   * are; getting that flare right is most of the difference between a big cat
   * and a scaled-up domestic one.
   */
  const skull = new THREE.Mesh(
    loft(
      resample(
        [
          { x: -skullLen * 0.46, y: 0, up: skullW * 0.42, down: skullW * 0.4, half: skullW * 0.4 },
          { x: -skullLen * 0.2, y: skullW * 0.04, up: skullW * 0.5, down: skullW * 0.5, half: skullW * 0.56 },
          { x: skullLen * 0.08, y: skullW * 0.02, up: skullW * 0.46, down: skullW * 0.52, half: skullW * 0.54 },
          { x: skullLen * 0.32, y: -skullW * 0.05, up: skullW * 0.32, down: skullW * 0.4, half: skullW * 0.36 },
          { x: skullLen * 0.46, y: -skullW * 0.11, up: skullW * 0.22, down: skullW * 0.26, half: skullW * 0.26 },
          { x: skullLen * 0.56, y: -skullW * 0.15, up: skullW * 0.15, down: skullW * 0.17, half: skullW * 0.17 },
        ],
        fine ? 16 : mid ? 11 : 7,
      ),
      fine ? 22 : mid ? 15 : 10,
      (along, down, _lateral, at, out) => {
        /*
         * The face pattern, painted rather than glued on: white round the
         * muzzle and under the eyes, black bars fanning back over the cheeks
         * and forehead, and nothing on the nose bridge itself.
         */
        const forward = Math.max(0, (along - 0.62) / 0.38);
        const under = Math.max(0, (down - 0.42) / 0.58);
        // The muzzle's white needs *both*: far enough forward and low enough on
        // the face. The bridge of the nose stays orange.
        const muzzle = forward * Math.min(1, under * 1.6);
        const throat = Math.max(0, (down - 0.78) / 0.22);
        const white = Math.min(1, Math.max(muzzle * 0.95, throat * 0.8));
        let marks =
          c.pattern === 'stripes'
            ? stripeField(along * 0.85, Math.min(1, down * 1.2), 8, seed + 21) * 0.8
            : rosetteField(along, down, seed + 4) * 0.55;
        marks *= 1 - Math.min(1, muzzle * 1.4);
        coatColour(out, c, 0.02, Math.min(1, down * 0.42 + white * 0.8), marks, seed + at);
      },
    ),
    headMaterial,
  );
  skull.castShadow = true;
  head.add(skull);

  /*
   * The cheek ruff.
   *
   * On a mature tiger this stands out well past the jawline as two pale fans,
   * and it is most of what makes the head read as a *tiger's* from a distance
   * rather than as a scaled-up domestic cat's. It is also the mass the head was
   * missing: without it the skull is a smooth wedge and the animal looks
   * long-nosed and small-headed however big the skull actually is.
   */
  if (fine) {
    for (const side of [-1, 1]) {
      const ruffMesh = new THREE.Mesh(
        loft(
          resample(
            [
              {
                x: skullLen * 0.26,
                y: -skullW * 0.06,
                z: side * skullW * 0.36,
                up: skullW * 0.02,
                down: skullW * 0.02,
                half: skullW * 0.02,
              },
              {
                x: -skullLen * 0.02,
                y: -skullW * 0.1,
                z: side * skullW * 0.58,
                up: skullW * 0.26,
                down: skullW * 0.3,
                half: skullW * 0.12,
              },
              {
                x: -skullLen * 0.34,
                y: -skullW * 0.12,
                z: side * skullW * 0.4,
                up: skullW * 0.02,
                down: skullW * 0.02,
                half: skullW * 0.02,
              },
            ],
            10,
          ),
          12,
          (along, down, _lateral, at, out) => {
            // Pale, and barred: the ruff carries the ends of the cheek stripes.
            const marks = c.pattern === 'stripes' ? stripeField(along, down, 6, seed + 9) * 0.6 : 0;
            coatColour(out, c, 0.02, 0.45 + down * 0.35, marks, seed + at);
          },
        ),
        headMaterial,
      );
      ruffMesh.castShadow = true;
      head.add(ruffMesh);
    }
  }

  // The nose: a small blunt pad of leather at the end of the muzzle.
  if (fine) {
  const nose = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.1, 12, 8), gloss(0x7a463c));
  nose.scale.set(0.7, 0.8, 1);
  nose.position.set(skullLen * 0.6, -skullW * 0.13, 0);
  head.add(nose);
  for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.035, 8, 6), flat(0x150f0d, 0.9));
      nostril.scale.set(0.7, 1, 0.7);
      nostril.position.set(skullLen * 0.638, -skullW * 0.145, side * skullW * 0.055);
      head.add(nostril);
    }
  }

  /*
   * ## The eye
   *
   * Five parts, because an eye is the one thing on an animal a player looks
   * *at* rather than past, and a ball of amber is what makes a model read as a
   * toy however good the body is:
   *
   *   • a **sclera** ball, mostly hidden, which is what the lids close over;
   *   • an **iris** disc carrying a generated texture of radial fibres and a
   *     dark limbal ring — the ring is the part whose absence looks uncanny;
   *   • a **slit pupil**, which is a cat's and nothing else's;
   *   • a **cornea**: a slightly larger, almost-smooth transparent cap, which is
   *     where the highlight actually lives. A wet eye is not a shiny eye — it is
   *     a dry eye with a lens of water on it, and the highlight sits on the
   *     water, offset from the iris underneath;
   *   • **lids** in coat colour, top and bottom, which frame it and stop the
   *     ball reading as a bead pushed into the head.
   */
  const eyeR = skullW * 0.075;
  if (fine) {
    for (const side of [-1, 1]) {
      const socket = new THREE.Group();
      socket.position.set(skullLen * 0.17, skullW * 0.14, side * skullW * 0.3);
      // Eyes face forward and a little outward, as a predator's do.
      socket.rotation.y = side * 0.42;
      head.add(socket);

      const sclera = new THREE.Mesh(
        new THREE.SphereGeometry(eyeR, 14, 12),
        flat(0xdcd2c4, 0.35),
      );
      socket.add(sclera);

      const iris = new THREE.Mesh(
        new THREE.CircleGeometry(eyeR * 0.92, 20),
        (() => {
          const m = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0 });
          const texture = irisTexture(0xd39b2c);
          if (texture) m.map = texture;
          else m.color = new THREE.Color(0xd39b2c);
          return m;
        })(),
      );
      iris.position.x = eyeR * 0.72;
      iris.rotation.y = Math.PI / 2;
      socket.add(iris);

      const pupil = new THREE.Mesh(
        new THREE.CircleGeometry(eyeR * 0.34, 14),
        flat(0x07060a, 0.2),
      );
      pupil.scale.set(1, 1, 0.42);
      pupil.position.x = eyeR * 0.76;
      pupil.rotation.y = Math.PI / 2;
      pupil.rotation.z = Math.PI / 2;
      socket.add(pupil);

      /*
       * The cornea. Transparent, nearly smooth, and *not* writing depth — so
       * the iris shows through it and the highlight lands on top of the eye
       * rather than replacing it.
       */
      const cornea = new THREE.Mesh(
        new THREE.SphereGeometry(eyeR * 1.06, 14, 12),
        new THREE.MeshPhysicalMaterial({
          transparent: true,
          opacity: 0.32,
          roughness: 0.04,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          depthWrite: false,
        }),
      );
      socket.add(cornea);

      // Lids: two shallow arcs of coat, the upper heavier than the lower.
      for (const lid of [1, -1]) {
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(eyeR * 1.16, 14, 10, 0, Math.PI * 2, lid > 0 ? 0 : 2.1, 1.1),
          headMaterial,
        );
        if (!mapped) paintSolid(shell.geometry, c, lid > 0 ? 0.25 : 0.55);
        shell.rotation.z = lid > 0 ? -0.35 : 0.25;
        socket.add(shell);
      }
    }
  } else {
    // Far away: one dark bead a side. Anything more is sub-pixel.
    for (const side of [-1, 1]) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 8, 6), flat(0x1a1208, 0.4));
      bead.position.set(skullLen * 0.17, skullW * 0.14, side * skullW * 0.3);
      head.add(bead);
    }
  }

  /*
   * Ears: small, round, set wide on the corners of the skull, black behind with
   * the white spot every tiger carries there.
   */
  const ears: THREE.Object3D[] = [];
  if (mid) for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(-skullLen * 0.24, skullW * 0.44, side * skullW * 0.33);
    ear.rotation.x = side * 0.5;
    ear.rotation.z = -0.16;
    ear.userData.side = side;
    ear.userData.baseX = ear.rotation.x;
    head.add(ear);
    ears.push(ear);

    const shell = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.19, 14, 10), flat(0x241c17, 0.9));
    shell.scale.set(0.42, 1, 1);
    ear.add(shell);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.145, 12, 8), flat(0xcbb097, 0.9));
    inner.scale.set(0.36, 0.88, 0.82);
    inner.position.set(skullW * 0.06, -skullW * 0.01, 0);
    ear.add(inner);
    if (fine) {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.055, 10, 8), flat(0xe8e0d2, 0.9));
      spot.scale.set(0.35, 1, 0.95);
      spot.position.set(-skullW * 0.06, -skullW * 0.02, 0);
      ear.add(spot);
    }
  }

  /*
   * The lower jaw, hinged at the back of the skull, with canines on both jaws.
   * The hinge is what makes a bite open a gap rather than slide a mouth down.
   */
  const jaw = new THREE.Group();
  jaw.position.set(-skullLen * 0.3, -skullW * 0.28, 0);
  head.add(jaw);
  if (mid) {
  const jawMesh = new THREE.Mesh(
    loft(
      resample(
        [
          { x: 0, y: 0, up: skullW * 0.14, down: skullW * 0.16, half: skullW * 0.3 },
          { x: skullLen * 0.42, y: -skullW * 0.01, up: skullW * 0.12, down: skullW * 0.13, half: skullW * 0.26 },
          { x: skullLen * 0.82, y: -skullW * 0.04, up: skullW * 0.08, down: skullW * 0.08, half: skullW * 0.15 },
        ],
        fine ? 8 : mid ? 6 : 4,
      ),
      fine ? 14 : mid ? 10 : 8,
      (_along, _down, _lateral, at, out) => coatColour(out, c, 0.02, 0.94, 0, seed + at),
    ),
    headMaterial,
  );
  jaw.add(jawMesh);
  }

  if (fine) {
    const tooth = (
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      len: number,
      down: boolean,
    ): void => {
      const t = new THREE.Mesh(new THREE.ConeGeometry(len * 0.26, len, 8), flat(0xf4efe3, 0.35));
      t.position.set(x, y, z);
      t.rotation.z = down ? Math.PI : 0;
      parent.add(t);
    };
    for (const side of [-1, 1]) {
      tooth(head, skullLen * 0.34, -skullW * 0.3, side * skullW * 0.15, skullW * 0.22, true);
      tooth(jaw, skullLen * 0.62, skullW * 0.05, side * skullW * 0.13, skullW * 0.2, false);
    }
    /*
     * Whiskers. Thin — a whisker is half a millimetre thick, and the first
     * attempt at three millimetres put a set of white slats on the animal's
     * face. Six a side, fanned and swept back.
     */
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const whisker = new THREE.Mesh(
          new THREE.BoxGeometry(skullLen * (0.38 + i * 0.05), skullW * 0.006, skullW * 0.006),
          flat(0xe6dccb, 0.6),
        );
        whisker.position.set(skullLen * 0.5, -skullW * (0.2 - i * 0.035), side * skullW * 0.17);
        whisker.rotation.y = side * (0.55 + i * 0.1);
        whisker.rotation.z = -0.12 + i * 0.05;
        head.add(whisker);
      }
    }
  }

  // --- Legs ---------------------------------------------------------------
  /*
   * ## What a big cat's leg is
   *
   * Not a cylinder, and not the same front and back. The foreleg is a straight
   * heavy column, thickest at the shoulder, tapering to a narrow wrist. The
   * hind leg carries all its mass in the thigh and then narrows sharply to a
   * hock — so above the knee the hind leg is the thicker of the two, and below
   * it the foreleg is.
   *
   * Each limb is a hip group (swings about Z), an upper loft, a knee group
   * (folds about Z), a lower loft and a paw: the structure the animator drives.
   * The lofts run along +X like every other one in this file and the meshes are
   * turned a quarter turn to hang them downwards.
   */
  const legs: THREE.Object3D[] = [];
  const knees: THREE.Object3D[] = [];
  const ankles: THREE.Object3D[] = [];
  const upperLen = H * 0.33;
  const lowerLen = H * 0.27;

  const buildLeg = (front: boolean, side: number): void => {
    const hip = new THREE.Group();
    hip.position.set(front ? bl * 0.32 : -bl * 0.38, -H * 0.06, side * H * 0.115);
    hip.userData.front = front;
    hip.userData.side = side;
    body.add(hip);
    legs.push(hip);

    const top = H * (front ? 0.115 : 0.14);
    // Mid-shaft radius. Named for the anatomy, not for the level of detail —
    // it was called `mid` and shadowed the LOD flag of that name.
    const shaft = H * (front ? 0.072 : 0.063);
    const ankle = H * (front ? 0.056 : 0.048);

    /**
     * How white this point on a leg is.
     *
     * A tiger's legs are orange outside and white on the inside face, and the
     * white climbs higher the further down the leg you go until the whole
     * lower leg is pale. `lateral` is the sine of the section angle — positive
     * towards +Z — so facing the body's centreline means the sign opposes the
     * side the leg is on.
     */
    const paleness = (along: number, lateral: number): number => {
      const inward = Math.max(0, -lateral * side);
      /*
       * Weighted so the *outside* of the leg stays coat-coloured all the way
       * down. The first pass had white creeping round the whole limb, which
       * turned four orange legs into four pale sticks — the pale is a band up
       * the inner face and a wash over the paw, and nothing else.
       */
      return Math.min(1, 0.44 + Math.pow(inward, 1.6) * 0.45 + along * 0.12);
    };

    /*
     * The muscle over the joint: a deltoid on the front pair, the great slab of
     * a thigh on the back. Without it there is a visible step where the leg tube
     * leaves the barrel, and the animal looks assembled rather than grown.
     */
    if (fine) {
      const bulge = new THREE.Mesh(
        loft(
          resample(
            [
              { x: -top * 1.25, y: 0, up: top * 0.05, down: top * 0.05, half: top * 0.06 },
              {
                x: upperLen * (front ? 0.28 : 0.34),
                y: 0,
                up: top * (front ? 1.0 : 1.14),
                down: top * (front ? 0.96 : 1.08),
                half: top * (front ? 0.7 : 0.82),
              },
              { x: upperLen * (front ? 0.94 : 1.0), y: 0, up: top * 0.05, down: top * 0.05, half: top * 0.06 },
            ],
            10,
          ),
          14,
          (along, _down, lateral, at, out) => {
            const marks =
              c.pattern === 'stripes'
                ? stripeField(along * 0.9, 0.3, 6, seed + (front ? 33 : 43)) * 0.9
                : rosetteField(along * 0.5, 0.3, seed + 8) * 0.7;
            coatColour(out, c, 0.35, Math.min(1, 0.46 + Math.max(0, -lateral * side) * 0.3), marks, seed + at);
          },
        ),
        limbMaterial,
      );
      bulge.rotation.z = -Math.PI / 2;
      bulge.castShadow = true;
      rollUv(bulge.geometry, side > 0 ? -0.25 : 0.25);
      hip.add(bulge);
    }

    const upper = new THREE.Mesh(
      loft(
        resample(
          [
            { x: 0, y: 0, up: top, down: top * 0.95, half: top * 0.9 },
            { x: upperLen * 0.42, y: 0, up: top * 0.86, down: top * 0.8, half: top * 0.78 },
            { x: upperLen, y: 0, up: shaft, down: shaft, half: shaft * 0.95 },
          ],
          fine ? 9 : mid ? 5 : 3,
        ),
        fine ? 14 : mid ? 10 : 7,
        (along, _down, lateral, at, out) => {
          const marks =
            c.pattern === 'stripes'
              ? stripeField(along * 1.5, 0.35, 6, seed + (front ? 31 : 41)) * (1 - along * 0.55)
              : rosetteField(along * 0.6, 0.35, seed + 7) * 0.6;
          coatColour(out, c, 0.4, paleness(along * 0.5, lateral), marks, seed + at);
        },
      ),
      limbMaterial,
    );
    upper.rotation.z = -Math.PI / 2;
    upper.castShadow = true;
    rollUv(upper.geometry, side > 0 ? -0.25 : 0.25);
    hip.add(upper);

    const knee = new THREE.Group();
    knee.position.y = -upperLen;
    knee.userData.fold = front ? -1 : 1;
    hip.add(knee);
    knees.push(knee);

    const lower = new THREE.Mesh(
      loft(
        resample(
          [
            { x: 0, y: 0, up: shaft, down: shaft, half: shaft * 0.95 },
            {
              x: lowerLen * 0.45,
              y: front ? 0 : H * 0.022,
              up: ankle * 1.25,
              down: ankle * 1.25,
              half: ankle * 1.15,
            },
            { x: lowerLen, y: front ? 0 : H * 0.055, up: ankle, down: ankle, half: ankle },
          ],
          fine ? 8 : mid ? 5 : 3,
        ),
        fine ? 12 : mid ? 9 : 7,
        (along, _down, lateral, at, out) => {
          const marks =
            c.pattern === 'stripes'
              ? stripeField(0.35 + along * 0.8, 0.35, 4, seed + 51) * Math.max(0, 0.55 - along * 0.8)
              : 0;
          coatColour(out, c, 0.5, paleness(0.5 + along * 0.5, lateral), marks, seed + at);
        },
      ),
      limbMaterial,
    );
    lower.rotation.z = -Math.PI / 2;
    lower.castShadow = true;
    rollUv(lower.geometry, side > 0 ? -0.25 : 0.25);
    knee.add(lower);

    /*
     * The paw: broad, round and blunt, with four toes off a heel pad and a claw
     * at the end of each. The gaps between the toes are the whole point — a paw
     * without them is a block, which is what the old model had.
     */
    /*
     * The ankle. A cat's wrist and hock stay nearly vertical while the paw
     * rolls flat under them, and without a joint here the whole foot pitches
     * with the shank — which is what makes a two-segment limb walk like a
     * stilt. The animator counter-rotates this against the leg's swing.
     */
    const ankleJoint = new THREE.Group();
    ankleJoint.position.y = -lowerLen;
    knee.add(ankleJoint);
    ankles.push(ankleJoint);

    if (!mid) return;
    const paw = new THREE.Group();
    paw.position.y = -ankle * 0.3;
    ankleJoint.add(paw);
    const pawR = ankle * (front ? 1.5 : 1.36);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(pawR, fine ? 12 : 7, fine ? 9 : 5), pawMaterial);
    pad.scale.set(1.1, 0.62, 1.02);
    if (!mapped) paintSolid(pad.geometry, c, 0.6);
    paw.add(pad);
    const toes = fine ? 4 : 0;
    for (let t = 0; t < toes; t++) {
      const across = t / (toes - 1) - 0.5;
      const toe = new THREE.Group();
      toe.position.set(pawR * 0.45, -pawR * 0.08, across * pawR * 1.45);
      toe.rotation.y = -across * 0.55;
      paw.add(toe);
      const reach = pawR * (0.72 - Math.abs(across) * 0.2);
      const segment = new THREE.Mesh(new THREE.SphereGeometry(reach, 8, 6), pawMaterial);
      segment.scale.set(1, 0.6, 0.6);
      segment.position.x = reach * 0.6;
      if (!mapped) paintSolid(segment.geometry, c, 0.66);
      toe.add(segment);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(ankle * 0.1, ankle * 0.3, 7), flat(0xd8cdba, 0.45));
      claw.rotation.z = -Math.PI / 2 + 0.75;
      claw.position.set(reach * 1.4, -ankle * 0.12, 0);
      toe.add(claw);
    }
  };

  buildLeg(true, 1);
  buildLeg(true, -1);
  buildLeg(false, 1);
  buildLeg(false, -1);

  // --- Tail ---------------------------------------------------------------
  /*
   * A little longer than the barrel, thick at the root, ringed black to a solid
   * black tip. A chain of groups so the animator's travelling wave has
   * something to travel down, with a slight droop baked into each joint: a tail
   * held dead straight is the other classic tell of a model.
   */
  const tail: THREE.Object3D[] = [];
  const tailLen = bl * 0.78;
  const segments = fine ? 7 : mid ? 5 : 2;
  let parent: THREE.Object3D = body;
  for (let i = 0; i < segments; i++) {
    const g = new THREE.Group();
    if (i === 0) g.position.set(-bl * 0.52, H * 0.1, 0);
    else g.position.x = -tailLen / segments;
    // Positive Z is droop for a segment that runs along −X, and the animator
    // subtracts its lift from the same axis.
    g.rotation.z = i === 0 ? 0.12 : 0.17;
    parent.add(g);
    tail.push(g);
    parent = g;

    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const r0 = H * 0.055 * (1 - t0 * 0.45);
    const r1 = H * 0.055 * (1 - t1 * 0.45);
    const segLen = tailLen / segments;
    const mesh = new THREE.Mesh(
      loft(
        [
          { x: 0, y: 0, up: r0, down: r0, half: r0 },
          { x: -segLen * 0.5, y: 0, up: (r0 + r1) * 0.5, down: (r0 + r1) * 0.5, half: (r0 + r1) * 0.5 },
          { x: -segLen * 1.02, y: 0, up: r1, down: r1, half: r1 },
        ],
        fine ? 12 : mid ? 8 : 6,
        (along, down, _lateral, _at, out) => {
          // Rings, closer together towards the tip, and the last hand's width
          // solid black — which is what a tiger's tail ends in.
          const u = t0 + (t1 - t0) * along;
          const ring = c.pattern === 'stripes' ? Math.pow(Math.max(0, Math.sin(u * 24 + 1.2)), 5) : 0;
          const tip = Math.max(0, (u - 0.9) / 0.1);
          coatColour(out, c, 0.6, 0.3 + down * 0.25, Math.max(ring, tip), seed + u * 31);
        },
      ),
      tailMaterial,
    );
    mesh.castShadow = true;
    g.add(mesh);
  }

  return { body, head, jaw, legs, knees, ankles, ears, tail };
}

/**
 * Paint a plain geometry in one coat tone.
 *
 * Paws and toes are spheres rather than lofts — too small and too round for a
 * profile to be worth stating — but they still need vertex colours, because
 * they share the one material every other part of the cat uses.
 */
function paintSolid(geometry: THREE.BufferGeometry, c: Coat, down: number): void {
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const scratch = new THREE.Color();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const span = Math.max(1e-5, box.max.y - box.min.y);
  for (let i = 0; i < position.count; i++) {
    /*
     * Shaded by height, not painted flat. A paw is coat-coloured across the top
     * of the foot and pale underneath; one tone for the whole sphere turned all
     * four feet into cream socks.
     */
    const height = (position.getY(i) - box.min.y) / span;
    coatColour(scratch, c, 0.9, Math.max(0, Math.min(1, down + (0.5 - height) * 0.55)), 0, i * 0.37);
    colours[i * 3] = scratch.r;
    colours[i * 3 + 1] = scratch.g;
    colours[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}
