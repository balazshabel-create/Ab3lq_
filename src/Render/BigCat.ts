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

// ---------------------------------------------------------------------------
// The coat
// ---------------------------------------------------------------------------

/**
 * A fur surface map: fine directional noise, used as bump and roughness.
 *
 * Vertex colours give the coat its *pattern*; this gives it its *texture*. A
 * smoothly shaded lofted body with no surface variation reads as painted
 * plastic — the light falls across it in one clean gradient, which is exactly
 * what fur never does. The strokes run along the map's U, which the loft lays
 * along the body, so the grain follows the animal from nose to tail.
 */
let furTexture: THREE.CanvasTexture | null | undefined;

function furMap(): THREE.CanvasTexture | null {
  if (furTexture !== undefined) return furTexture;
  if (typeof document === 'undefined') {
    furTexture = null;
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const len = 3 + Math.random() * 9;
    const v = Math.random() < 0.5 ? 60 + Math.random() * 50 : 150 + Math.random() * 70;
    ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.lineWidth = 0.7 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Swept back and slightly down, the way a coat lies.
    ctx.lineTo(x + len, y + (Math.random() - 0.4) * 2.5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 3);
  furTexture = texture;
  return texture;
}

let coatMaterial: THREE.Material | null = null;

/**
 * One material for every part of the cat.
 *
 * It can be one because all the colour lives in the vertices — body, legs, head
 * and tail share it, so the whole animal is a handful of draw calls however much
 * pattern it carries. Standard rather than Lambert: fur is not perfectly
 * diffuse, and the faint sheen along a lit flank is most of what stops a model
 * looking like a toy.
 */
function coat(): THREE.Material {
  if (coatMaterial) return coatMaterial;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0,
    roughness: 0.86,
  });
  const fur = furMap();
  if (fur) {
    material.bumpMap = fur;
    material.bumpScale = 1.4;
    material.roughnessMap = fur;
  }
  coatMaterial = material;
  return material;
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

/**
 * One cross-section of a lofted part.
 *
 * `up` and `down` are separate radii because animals are not elliptical: a
 * cat's chest is deep below the spine and shallow above it, and its belly is
 * flatter than its back. Two radii cost nothing and are the difference between
 * a body and a tube.
 */
interface Station {
  /** Position of the section's centre, along and above the part's axis. */
  x: number;
  y: number;
  z?: number;
  up: number;
  down: number;
  half: number;
}

/**
 * Skin a set of cross-sections into one continuous surface.
 *
 * The surface runs along +X. Both ends are closed with a fan so the part is a
 * solid object rather than a pipe. `colour` is called per vertex with its
 * position along the part (0..1) and around it (0 at the top, 1 at the bottom),
 * which is what lets the pattern be evaluated in the mesh.
 */
function loft(
  stations: Station[],
  segments: number,
  colour: (
    along: number,
    down: number,
    lateral: number,
    at: number,
    out: THREE.Color,
  ) => void,
): THREE.BufferGeometry {
  const rings = stations.length;
  const positions: number[] = [];
  const colours: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const scratch = new THREE.Color();

  for (let i = 0; i < rings; i++) {
    const s = stations[i];
    const along = i / (rings - 1);
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const y = s.y + c * (c >= 0 ? s.up : s.down);
      const z = (s.z ?? 0) + sn * s.half;
      positions.push(s.x, y, z);
      // 0 at the top of the section, 1 at the bottom, either side alike.
      const down = Math.acos(Math.max(-1, Math.min(1, c))) / Math.PI;
      /*
       * `down` cannot tell left from right — it is an angle from the top, and
       * both flanks are equally far round it — so the sine of the section angle
       * goes along too. A body does not care; a leg does, because it is white on
       * the inside face and orange on the outside.
       *
       * The last argument is one number standing for "where on the animal this
       * vertex is", which is all the colour function ever wanted the coordinates
       * for: a stable seed for mottling that does not repeat between parts.
       */
      colour(along, down, sn, s.x * 3.1 + y * 7.7 + z * 1.7, scratch);
      colours.push(scratch.r, scratch.g, scratch.b);
      uvs.push(along, j / segments);
    }
  }

  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  // Caps: a fan to a point on the axis at each end, so nothing is hollow.
  const cap = (ring: number, station: Station, flip: boolean): void => {
    const centre = positions.length / 3;
    positions.push(station.x, station.y, station.z ?? 0);
    colour(flip ? 0 : 1, 0.5, 0, station.x * 3.1 + station.y * 7.7, scratch);
    colours.push(scratch.r, scratch.g, scratch.b);
    uvs.push(flip ? 0 : 1, 0.5);
    for (let j = 0; j < segments; j++) {
      const a = ring * (segments + 1) + j;
      if (flip) indices.push(centre, a + 1, a);
      else indices.push(centre, a, a + 1);
    }
  };
  cap(0, stations[0], true);
  cap(rings - 1, stations[rings - 1], false);

  /*
   * ## Which way is out?
   *
   * The winding of a quad grid — and therefore the direction of every normal
   * derived from it — depends on whether the stations were listed front-to-back
   * or back-to-front. The body's run from the neck towards the tail and came out
   * facing outwards; the neck, skull, jaw and legs run the other way and came
   * out facing *inwards*, so they were lit from inside and rendered as pale
   * ambient-blue shapes. On a screenshot that looks like a colour bug, which is
   * exactly the wrong place to go looking.
   *
   * Rather than demand that every caller list its sections in one direction —
   * a rule that is invisible at the call site and would be broken again — the
   * surface measures its own signed volume and flips the winding if it came out
   * inside out.
   */
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const cc = indices[i + 2] * 3;
    // Six times the signed volume of the tetrahedron from the origin.
    volume +=
      positions[a] * (positions[b + 1] * positions[cc + 2] - positions[b + 2] * positions[cc + 1]) -
      positions[a + 1] * (positions[b] * positions[cc + 2] - positions[b + 2] * positions[cc]) +
      positions[a + 2] * (positions[b] * positions[cc + 1] - positions[b + 1] * positions[cc]);
  }
  if (volume < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = swap;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Interpolate a station list up to `count` sections, smoothing the profile. */
function resample(key: Station[], count: number): Station[] {
  const out: Station[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * (key.length - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(key.length - 1, i0 + 1);
    // Smoothstep between control sections: a linear blend leaves a visible
    // crease at every one of them, which is the seam problem again in miniature.
    const raw = t - i0;
    const k = raw * raw * (3 - 2 * raw);
    const a = key[i0];
    const b = key[i1];
    out.push({
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * k,
      up: a.up + (b.up - a.up) * k,
      down: a.down + (b.down - a.down) * k,
      half: a.half + (b.half - a.half) * k,
    });
  }
  return out;
}


// ---------------------------------------------------------------------------
// The cat
// ---------------------------------------------------------------------------

/** What the builder reports back, in the shape the animator already drives. */
export interface BigCatParts {
  body: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Object3D;
  legs: THREE.Object3D[];
  knees: THREE.Object3D[];
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
  const fine = detail > 0.5;
  const material = coat();

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
    loft(resample(key, fine ? 44 : 11), fine ? 28 : 9, (along, down, _lateral, at, out) => {
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
        fine ? 12 : 6,
      ),
      fine ? 20 : 10,
      (along, down, _lateral, at, out) => {
        const marks = c.pattern === 'stripes' ? stripeField(along * 0.14, down, 15, seed + 5) : 0;
        coatColour(out, c, 0.04, down, marks, seed + at);
      },
    ),
    material,
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
        fine ? 16 : 7,
      ),
      fine ? 22 : 10,
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
    material,
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
        material,
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
   * Eyes: forward-facing, amber, and *small* — a tiger's eye is about three
   * centimetres across on a head a third of a metre long, and the first version
   * of this model had them at twice that, which is the difference between a
   * predator and a plush toy. Set into a dark rim so they sit in the skull.
   */
  if (fine) for (const side of [-1, 1]) {
    const x = skullLen * 0.14;
    const y = skullW * 0.14;
    const z = side * skullW * 0.32;
    if (fine) {
      const rim = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.085, 10, 8), flat(0x140f0c, 0.85));
      rim.scale.set(0.7, 1, 1);
      rim.position.set(x - skullW * 0.01, y, z);
      head.add(rim);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.062, 12, 10), gloss(0xcf9a2e));
    eye.position.set(x + skullW * 0.03, y, z + side * skullW * 0.01);
    head.add(eye);
    if (fine) {
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.03, 8, 8), gloss(0x090706));
      pupil.scale.set(0.45, 1.1, 0.5);
      pupil.position.set(x + skullW * 0.075, y, z + side * skullW * 0.02);
      head.add(pupil);
    }
  }

  /*
   * Ears: small, round, set wide on the corners of the skull, black behind with
   * the white spot every tiger carries there.
   */
  const ears: THREE.Object3D[] = [];
  if (fine) for (const side of [-1, 1]) {
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
      const spot = new THREE.Mesh(new THREE.SphereGeometry(skullW * 0.1, 10, 6), flat(0xf2ece2, 0.9));
      spot.scale.set(0.28, 1, 0.9);
      spot.position.set(-skullW * 0.075, skullW * 0.015, 0);
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
  if (fine) {
  const jawMesh = new THREE.Mesh(
    loft(
      resample(
        [
          { x: 0, y: 0, up: skullW * 0.14, down: skullW * 0.16, half: skullW * 0.3 },
          { x: skullLen * 0.42, y: -skullW * 0.01, up: skullW * 0.12, down: skullW * 0.13, half: skullW * 0.26 },
          { x: skullLen * 0.82, y: -skullW * 0.04, up: skullW * 0.08, down: skullW * 0.08, half: skullW * 0.15 },
        ],
        fine ? 8 : 4,
      ),
      fine ? 14 : 8,
      (_along, _down, _lateral, at, out) => coatColour(out, c, 0.02, 0.94, 0, seed + at),
    ),
    material,
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
    const mid = H * (front ? 0.072 : 0.063);
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
        material,
      );
      bulge.rotation.z = -Math.PI / 2;
      bulge.castShadow = true;
      hip.add(bulge);
    }

    const upper = new THREE.Mesh(
      loft(
        resample(
          [
            { x: 0, y: 0, up: top, down: top * 0.95, half: top * 0.9 },
            { x: upperLen * 0.42, y: 0, up: top * 0.86, down: top * 0.8, half: top * 0.78 },
            { x: upperLen, y: 0, up: mid, down: mid, half: mid * 0.95 },
          ],
          fine ? 9 : 3,
        ),
        fine ? 14 : 7,
        (along, _down, lateral, at, out) => {
          const marks =
            c.pattern === 'stripes'
              ? stripeField(along * 1.5, 0.35, 6, seed + (front ? 31 : 41)) * (1 - along * 0.55)
              : rosetteField(along * 0.6, 0.35, seed + 7) * 0.6;
          coatColour(out, c, 0.4, paleness(along * 0.5, lateral), marks, seed + at);
        },
      ),
      material,
    );
    upper.rotation.z = -Math.PI / 2;
    upper.castShadow = true;
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
            { x: 0, y: 0, up: mid, down: mid, half: mid * 0.95 },
            {
              x: lowerLen * 0.45,
              y: front ? 0 : H * 0.022,
              up: ankle * 1.25,
              down: ankle * 1.25,
              half: ankle * 1.15,
            },
            { x: lowerLen, y: front ? 0 : H * 0.055, up: ankle, down: ankle, half: ankle },
          ],
          fine ? 8 : 3,
        ),
        fine ? 12 : 7,
        (along, _down, lateral, at, out) => {
          const marks =
            c.pattern === 'stripes'
              ? stripeField(0.35 + along * 0.8, 0.35, 4, seed + 51) * Math.max(0, 0.55 - along * 0.8)
              : 0;
          coatColour(out, c, 0.5, paleness(0.5 + along * 0.5, lateral), marks, seed + at);
        },
      ),
      material,
    );
    lower.rotation.z = -Math.PI / 2;
    lower.castShadow = true;
    knee.add(lower);

    /*
     * The paw: broad, round and blunt, with four toes off a heel pad and a claw
     * at the end of each. The gaps between the toes are the whole point — a paw
     * without them is a block, which is what the old model had.
     */
    if (!fine) return;
    const paw = new THREE.Group();
    paw.position.y = -lowerLen - ankle * 0.3;
    knee.add(paw);
    const pawR = ankle * (front ? 1.5 : 1.36);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(pawR, fine ? 12 : 7, fine ? 9 : 5), material);
    pad.scale.set(1.1, 0.62, 1.02);
    paintSolid(pad.geometry, c, 0.6);
    paw.add(pad);
    const toes = fine ? 4 : 0;
    for (let t = 0; t < toes; t++) {
      const across = t / (toes - 1) - 0.5;
      const toe = new THREE.Group();
      toe.position.set(pawR * 0.45, -pawR * 0.08, across * pawR * 1.45);
      toe.rotation.y = -across * 0.55;
      paw.add(toe);
      const reach = pawR * (0.72 - Math.abs(across) * 0.2);
      const segment = new THREE.Mesh(new THREE.SphereGeometry(reach, 8, 6), material);
      segment.scale.set(1, 0.6, 0.6);
      segment.position.x = reach * 0.6;
      paintSolid(segment.geometry, c, 0.66);
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
  const segments = fine ? 7 : 2;
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
        fine ? 12 : 6,
        (along, down, _lateral, _at, out) => {
          // Rings, closer together towards the tip, and the last hand's width
          // solid black — which is what a tiger's tail ends in.
          const u = t0 + (t1 - t0) * along;
          const ring = c.pattern === 'stripes' ? Math.pow(Math.max(0, Math.sin(u * 24 + 1.2)), 5) : 0;
          const tip = Math.max(0, (u - 0.9) / 0.1);
          coatColour(out, c, 0.6, 0.3 + down * 0.25, Math.max(ring, tip), seed + u * 31);
        },
      ),
      material,
    );
    mesh.castShadow = true;
    g.add(mesh);
  }

  return { body, head, jaw, legs, knees, ears, tail };
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
