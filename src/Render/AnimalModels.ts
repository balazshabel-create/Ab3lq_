/**
 * AnimalModels.ts — every animal in the game, built from primitives at runtime.
 *
 * There are no model files in this project. Each species is assembled from
 * boxes, spheres and cones according to its body plan and the proportions in
 * the species table, which means:
 *   • adding a species needs no art pipeline;
 *   • the repository stays small and the game loads instantly;
 *   • and, most importantly, a player's animal is built by exactly the same
 *     code as an AI animal of that species. They cannot look different, because
 *     there is only one function that can draw either of them.
 *
 * Each model exposes named parts so the animator can move legs, head and tail
 * without a skeleton — plain parent/child transforms are enough for animals
 * this size on screen, and they cost nothing.
 */

import * as THREE from 'three';
import {
  ANIMALS,
  BodyPlan,
  Species,
  type AnimalDef,
} from '../Animals/AnimalTypes';

/** The articulated parts an animator can drive. */
export interface AnimalModel {
  root: THREE.Group;
  /** Torso — squashes and bobs with the gait. */
  body: THREE.Object3D;
  /** Head — turns to look, dips to graze. */
  head: THREE.Object3D;
  /**
   * Lower jaw, hinged at the back of the mouth, or null if this plan has none.
   *
   * Rotating it open is what makes a bite read as a bite rather than as a lunge,
   * and a chew read as a chew rather than as a nod. It is a child of the head, so
   * it follows every head turn and dip for free.
   */
  jaw: THREE.Object3D | null;
  /** Legs, ordered front-left, front-right, back-left, back-right. */
  legs: THREE.Object3D[];
  /** Tail segments, base first. */
  tail: THREE.Object3D[];
  /** Wings, for flyers. */
  wings: THREE.Object3D[];
  /** Serpent body segments, head-first. */
  segments: THREE.Object3D[];
  /** Total body length in metres, for scaling effects. */
  length: number;
  /** Shoulder height, used to place the camera and the fly swarm. */
  height: number;
  species: Species;
  /** Materials owned by this model, so they can be tinted or disposed. */
  materials: THREE.Material[];
}

/**
 * Shared geometry cache.
 *
 * All animals of a species share their geometries and materials, so building
 * the fortieth capybara allocates nothing on the GPU.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.MeshLambertMaterial>();

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `box:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geometryCache.set(key, g);
  }
  return g;
}

function sphere(r: number, segments = 8): THREE.BufferGeometry {
  const key = `sph:${r.toFixed(3)}:${segments}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.SphereGeometry(r, segments, Math.max(4, segments >> 1));
    geometryCache.set(key, g);
  }
  return g;
}

function capsule(r: number, len: number): THREE.BufferGeometry {
  const key = `cap:${r.toFixed(3)}:${len.toFixed(3)}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.CapsuleGeometry(r, len, 4, 8);
    geometryCache.set(key, g);
  }
  return g;
}

function cone(r: number, h: number): THREE.BufferGeometry {
  const key = `cone:${r.toFixed(3)}:${h.toFixed(3)}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.ConeGeometry(r, h, 7);
    geometryCache.set(key, g);
  }
  return g;
}

function material(color: number, flat = true): THREE.MeshLambertMaterial {
  const key = `${color}:${flat}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: flat });
    materialCache.set(key, m);
  }
  return m;
}

function mesh(
  geometry: THREE.BufferGeometry,
  color: number,
  parent: THREE.Object3D,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

/**
 * Build a model for a species.
 *
 * `detail` trades polygons for distance: 1 = full articulation for animals
 * close to the camera, 0 = a simplified silhouette for the ones far away.
 */
export function buildAnimalModel(species: Species, detail = 1): AnimalModel {
  const def = ANIMALS[species];
  const root = new THREE.Group();
  const model: AnimalModel = {
    root,
    body: root,
    head: root,
    jaw: null,
    legs: [],
    tail: [],
    wings: [],
    segments: [],
    length: def.silhouette.length,
    height: def.silhouette.height,
    species,
    materials: [],
  };

  switch (def.silhouette.bodyPlan) {
    case BodyPlan.Quadruped:
      buildQuadruped(model, def, detail, 0);
      break;
    case BodyPlan.Feline:
      buildQuadruped(model, def, detail, 1);
      break;
    case BodyPlan.Reptile:
      buildReptile(model, def, detail);
      break;
    case BodyPlan.Serpent:
      buildSerpent(model, def, detail);
      break;
    case BodyPlan.Primate:
      buildPrimate(model, def, detail);
      break;
    case BodyPlan.Bird:
      buildBird(model, def, detail);
      break;
    case BodyPlan.Amphibian:
      buildAmphibian(model, def, detail);
      break;
    case BodyPlan.Shelled:
      buildShelled(model, def, detail);
      break;
    case BodyPlan.Fish:
      buildFish(model, def, detail);
      break;
    case BodyPlan.Insect:
      buildInsect(model, def, detail);
      break;
    default:
      buildQuadruped(model, def, detail, 0);
      break;
  }

  return model;
}

/**
 * Hinge a lower jaw onto a head.
 *
 * The group sits at the back of the mouth and the mesh hangs forward of it, so
 * rotating the group about Z swings the jaw open around a hinge rather than
 * sliding the whole mouth downwards.
 *
 * Positive Z rotation lifts +X towards +Y, so the animator opens a mouth with a
 * *negative* angle — the same sign convention as the head's nose-down dip.
 */
function addJaw(
  model: AnimalModel,
  head: THREE.Object3D,
  options: {
    hingeX: number;
    hingeY: number;
    length: number;
    height: number;
    width: number;
    color: number;
  },
): void {
  const group = new THREE.Group();
  group.position.set(options.hingeX, options.hingeY, 0);
  head.add(group);
  mesh(
    box(options.length, options.height, options.width),
    options.color,
    group,
    options.length * 0.5,
    -options.height * 0.5,
    0,
  );
  model.jaw = group;
}

// ---------------------------------------------------------------------------
// Body plans
// ---------------------------------------------------------------------------

/**
 * Capybara, peccary, tapir, anteater (style 0) and jaguar, ocelot (style 1).
 * Style 1 is leaner and lower-slung, with a longer tail.
 */
function buildQuadruped(
  model: AnimalModel,
  def: AnimalDef,
  detail: number,
  style: 0 | 1,
): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const H = s.height;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = H;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  // Torso: a capsule reads as a mammal far better than a box does.
  const torso = mesh(capsule(W * 0.5, L * (style === 1 ? 0.62 : 0.5)), c.body, bodyGroup);
  torso.rotation.z = Math.PI / 2;
  torso.scale.set(1, 1, style === 1 ? 0.85 : 1);

  // Belly, a lighter underside — cheap, and it makes the silhouette read.
  if (detail > 0.4) {
    const belly = mesh(capsule(W * 0.42, L * 0.42), c.belly, bodyGroup, 0, -H * 0.16, 0);
    belly.rotation.z = Math.PI / 2;
  }

  // Head on a short neck.
  const neck = new THREE.Group();
  neck.position.set(L * 0.48, H * 0.16, 0);
  bodyGroup.add(neck);
  model.head = neck;

  const skull = mesh(sphere(W * 0.42, detail > 0.5 ? 8 : 5), c.body, neck, L * 0.1, 0, 0);
  skull.scale.set(1.25, 0.95, 0.95);

  if (detail > 0.4) {
    // Snout.
    const snout = mesh(box(L * 0.16, H * 0.2, W * 0.34), c.body, neck, L * 0.22, -H * 0.06, 0);
    snout.scale.setScalar(1);
    addJaw(model, neck, {
      hingeX: L * 0.14,
      hingeY: -H * 0.1,
      length: L * 0.17,
      height: H * 0.09,
      width: W * 0.3,
      color: c.belly,
    });
    // Ears.
    for (const side of [-1, 1]) {
      mesh(cone(W * 0.12, H * 0.22), c.accent, neck, L * 0.04, W * 0.3, side * W * 0.26);
    }
    // Eyes.
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.075, 6), c.eye, neck, L * 0.18, H * 0.08, side * W * 0.24);
    }
  }

  // Legs. Front pair slightly forward of centre, back pair behind.
  if (detail > 0.25) {
    const legLen = H * 0.92;
    const legR = W * 0.13;
    const positions: [number, number][] = [
      [L * 0.3, W * 0.32],
      [L * 0.3, -W * 0.32],
      [-L * 0.3, W * 0.34],
      [-L * 0.3, -W * 0.34],
    ];
    for (const [x, z] of positions) {
      const hip = new THREE.Group();
      hip.position.set(x, -H * 0.1, z);
      bodyGroup.add(hip);
      const leg = mesh(capsule(legR, legLen * 0.55), c.body, hip, 0, -legLen * 0.42, 0);
      leg.castShadow = true;
      // Hoof / paw.
      if (detail > 0.6) mesh(box(legR * 2.2, legLen * 0.1, legR * 2.4), c.accent, hip, 0, -legLen * 0.86, 0);
      model.legs.push(hip);
    }
  }

  // Tail.
  if (s.tail > 0.05 && detail > 0.4) {
    const tailLen = L * s.tail;
    const base = new THREE.Group();
    base.position.set(-L * 0.5, H * 0.12, 0);
    bodyGroup.add(base);
    const segments = style === 1 ? 4 : 2;
    let parent: THREE.Object3D = base;
    for (let i = 0; i < segments; i++) {
      const segLen = tailLen / segments;
      const g = new THREE.Group();
      g.position.set(i === 0 ? 0 : -segLen, 0, 0);
      parent.add(g);
      const seg = new THREE.Mesh(
        capsule(Math.max(0.02, W * (0.11 - i * 0.02)), segLen * 0.6),
        material(c.body),
      );
      seg.rotation.z = Math.PI / 2;
      seg.position.x = -segLen * 0.5;
      g.add(seg);
      model.tail.push(g);
      parent = g;
    }
  }

  // Jaguar and ocelot spots: a handful of dark blobs, enough to read as a cat.
  if (style === 1 && detail > 0.6) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const spot = mesh(
        sphere(W * 0.09, 5),
        c.accent,
        bodyGroup,
        Math.cos(a * 1.7) * L * 0.3,
        Math.sin(a) * W * 0.3,
        Math.cos(a) * W * 0.42,
      );
      spot.scale.set(0.6, 0.6, 0.3);
    }
  }
}

/** Crocodile, caiman, iguana, chameleon: low, long, sprawling limbs. */
function buildReptile(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const H = s.height;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = H * 0.7;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  /*
   * Flattened torso.
   *
   * Careful with the scale axis. A capsule is built along its local Y, and
   * rotating it by 90° about Z maps local Y onto world X (the body's length) and
   * local X onto world Y (its height). Three.js composes transforms as T·R·S, so
   * the scale is applied in *local* space, before the rotation — scaling local Y
   * therefore shortens the body rather than flattening it, which detaches the
   * head and tail and leaves the animal visibly in three pieces. Flattening
   * vertically means scaling local X.
   */
  /*
   * The capsule has to be long enough to actually *reach* the head and tail
   * anchors (at ±0.4·L). At 0.4·L it fell short at both ends and the animal read
   * as three separate objects floating in a line.
   */
  const torso = mesh(capsule(W * 0.44, L * 0.62), c.body, bodyGroup);
  torso.rotation.z = Math.PI / 2;
  torso.scale.set(0.62, 1, 1);

  if (detail > 0.4) {
    const belly = mesh(box(L * 0.5, H * 0.18, W * 0.7), c.belly, bodyGroup, 0, -H * 0.28, 0);
    belly.receiveShadow = true;
  }

  // Long jaw.
  const head = new THREE.Group();
  head.position.set(L * 0.42, 0, 0);
  bodyGroup.add(head);
  model.head = head;

  // Shoulders: blends the head into the torso instead of butting against it.
  const shoulder = mesh(sphere(W * 0.44, detail > 0.5 ? 8 : 5), c.body, bodyGroup, L * 0.3, 0, 0);
  shoulder.scale.set(1, 0.6, 1);

  // Upper jaw, fixed to the skull.
  const upperJaw = mesh(box(L * 0.3, H * 0.2, W * 0.5), c.body, head, L * 0.12, H * 0.07, 0);
  upperJaw.scale.set(1, 1, 1);
  // Lower jaw, hinged — a crocodile's gape is its whole personality.
  addJaw(model, head, {
    hingeX: -L * 0.03,
    hingeY: -H * 0.02,
    length: L * 0.34,
    height: H * 0.15,
    width: W * 0.46,
    color: c.body,
  });
  if (detail > 0.4) {
    // Snout taper.
    const tip = mesh(box(L * 0.12, H * 0.24, W * 0.32), c.body, head, L * 0.3, -H * 0.02, 0);
    tip.scale.setScalar(1);
    // The famous eyes-above-the-water silhouette.
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.1, 6), c.eye, head, L * 0.02, H * 0.22, side * W * 0.2);
    }
    // Teeth.
    if (detail > 0.7) {
      for (let i = 0; i < 5; i++) {
        for (const side of [-1, 1]) {
          const t = mesh(
            cone(W * 0.03, H * 0.14),
            0xf2ece0,
            head,
            L * (0.08 + i * 0.05),
            -H * 0.12,
            side * W * 0.2,
          );
          t.rotation.x = Math.PI;
        }
      }
    }
  }

  // Sprawling legs.
  if (detail > 0.25) {
    const positions: [number, number][] = [
      [L * 0.26, W * 0.42],
      [L * 0.26, -W * 0.42],
      [-L * 0.24, W * 0.44],
      [-L * 0.24, -W * 0.44],
    ];
    for (const [x, z] of positions) {
      const hip = new THREE.Group();
      hip.position.set(x, -H * 0.2, z);
      bodyGroup.add(hip);
      const leg = mesh(capsule(W * 0.1, H * 0.4), c.body, hip, 0, -H * 0.25, Math.sign(z) * W * 0.1);
      leg.rotation.x = Math.sign(z) * 0.5;
      model.legs.push(hip);
    }
  }

  // Heavy tapering tail — the crocodile's whole back half.
  const tailLen = L * s.tail;
  if (tailLen > 0.05) {
    const base = new THREE.Group();
    base.position.set(-L * 0.4, 0, 0);
    bodyGroup.add(base);
    let parent: THREE.Object3D = base;
    const segments = detail > 0.5 ? 5 : 3;
    for (let i = 0; i < segments; i++) {
      const segLen = tailLen / segments;
      const g = new THREE.Group();
      g.position.x = i === 0 ? 0 : -segLen;
      parent.add(g);
      const taper = 1 - i / (segments + 1);
      const seg = new THREE.Mesh(box(segLen, H * 0.42 * taper, W * 0.62 * taper), material(c.body));
      seg.position.x = -segLen * 0.5;
      seg.castShadow = true;
      g.add(seg);
      // Dorsal scutes: the ridged back that makes a caiman look like a log.
      if (detail > 0.6 && i < segments - 1) {
        const scute = mesh(cone(W * 0.07 * taper, H * 0.2 * taper), c.accent, g, -segLen * 0.5, H * 0.24 * taper, 0);
        scute.rotation.z = 0;
      }
      model.tail.push(g);
      parent = g;
    }
  }
}

/** Anaconda and other snakes: a chain of segments that undulates. */
function buildSerpent(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = s.height * 0.6;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  const count = detail > 0.5 ? 12 : 6;
  const segLen = L / count;

  // Head.
  const head = new THREE.Group();
  bodyGroup.add(head);
  model.head = head;
  const skull = mesh(sphere(W * 0.5, detail > 0.5 ? 8 : 5), c.body, head);
  skull.scale.set(1.6, 0.7, 1);
  if (detail > 0.4) {
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.11, 6), c.eye, head, W * 0.4, W * 0.16, side * W * 0.3);
    }
    // Forked tongue, because it costs four triangles and sells the whole animal.
    if (detail > 0.75) {
      const tongue = mesh(box(W * 0.5, W * 0.03, W * 0.05), 0xc0392b, head, W * 1.0, -W * 0.1, 0);
      tongue.scale.setScalar(1);
    }
  }

  // Body segments, each parented in a chain so a sine wave through their
  // rotations produces a believable slither.
  let parent: THREE.Object3D = head;
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    g.position.x = -segLen;
    parent.add(g);
    // Taper towards the tail.
    const t = 1 - Math.pow(i / count, 1.8);
    const radius = Math.max(0.02, W * 0.5 * (0.55 + t * 0.45));
    const seg = new THREE.Mesh(capsule(radius, segLen * 0.7), material(i % 2 === 0 ? c.body : c.accent));
    seg.rotation.z = Math.PI / 2;
    seg.position.x = -segLen * 0.4;
    seg.castShadow = true;
    g.add(seg);
    model.segments.push(g);
    parent = g;
  }
}

/** Monkeys, howlers, sloths: upright-ish torso, long limbs, prehensile tail. */
function buildPrimate(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const H = s.height;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = H;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  const torso = mesh(capsule(W * 0.46, L * 0.44), c.body, bodyGroup);
  torso.rotation.z = Math.PI / 2.4;

  if (detail > 0.4) {
    const chest = mesh(sphere(W * 0.4, 7), c.belly, bodyGroup, L * 0.06, -H * 0.06, 0);
    chest.scale.set(0.9, 1.1, 0.8);
  }

  // Head with a face patch.
  const head = new THREE.Group();
  head.position.set(L * 0.3, H * 0.34, 0);
  bodyGroup.add(head);
  model.head = head;
  mesh(sphere(W * 0.44, detail > 0.5 ? 9 : 5), c.body, head);
  addJaw(model, head, {
    hingeX: W * 0.1,
    hingeY: -W * 0.16,
    length: W * 0.34,
    height: W * 0.1,
    width: W * 0.26,
    color: c.belly,
  });
  if (detail > 0.4) {
    const face = mesh(sphere(W * 0.3, 7), c.belly, head, W * 0.28, -W * 0.04, 0);
    face.scale.set(0.6, 0.85, 0.8);
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.07, 6), c.eye, head, W * 0.36, W * 0.1, side * W * 0.15);
      // Ears.
      mesh(sphere(W * 0.11, 5), c.body, head, -W * 0.02, W * 0.14, side * W * 0.42);
    }
  }

  // Four long limbs.
  if (detail > 0.25) {
    const limbs: [number, number, number][] = [
      [L * 0.2, W * 0.42, 1],
      [L * 0.2, -W * 0.42, 1],
      [-L * 0.22, W * 0.36, 0],
      [-L * 0.22, -W * 0.36, 0],
    ];
    for (const [x, z, isArm] of limbs) {
      const shoulder = new THREE.Group();
      shoulder.position.set(x, isArm ? H * 0.1 : -H * 0.12, z);
      bodyGroup.add(shoulder);
      const len = isArm ? H * 0.9 : H * 0.8;
      mesh(capsule(W * 0.11, len * 0.5), c.body, shoulder, 0, -len * 0.4, 0);
      if (detail > 0.6) mesh(sphere(W * 0.13, 5), c.accent, shoulder, 0, -len * 0.82, 0);
      model.legs.push(shoulder);
    }
  }

  // Long prehensile tail, curled.
  const tailLen = L * s.tail;
  if (tailLen > 0.1 && detail > 0.35) {
    const base = new THREE.Group();
    base.position.set(-L * 0.34, 0, 0);
    bodyGroup.add(base);
    let parent: THREE.Object3D = base;
    const segments = detail > 0.6 ? 6 : 3;
    for (let i = 0; i < segments; i++) {
      const segLen = tailLen / segments;
      const g = new THREE.Group();
      g.position.x = i === 0 ? 0 : -segLen;
      // Pre-curl the tail so it hangs in a natural arc.
      g.rotation.z = i === 0 ? -0.15 : -0.22;
      parent.add(g);
      const seg = new THREE.Mesh(
        capsule(Math.max(0.015, W * 0.09 * (1 - i / (segments + 2))), segLen * 0.7),
        material(c.body),
      );
      seg.rotation.z = Math.PI / 2;
      seg.position.x = -segLen * 0.5;
      g.add(seg);
      model.tail.push(g);
      parent = g;
    }
  }
}

/** Macaws, herons, eagles, bats: body, wings, two legs, tail feathers. */
function buildBird(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const H = s.height;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = H * 0.7;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  const torso = mesh(capsule(W * 0.44, L * 0.42), c.body, bodyGroup);
  torso.rotation.z = Math.PI / 2;
  // Local X is the vertical axis after the rotation — see the note in
  // buildReptile. Scaling local Y here would shorten the bird instead.
  torso.scale.set(0.9, 1, 0.85);

  // Neck and head. Herons get a long neck, which is their whole silhouette.
  const neckLen = def.species === Species.Heron ? H * 0.55 : H * 0.16;
  const neck = new THREE.Group();
  neck.position.set(L * 0.3, neckLen, 0);
  bodyGroup.add(neck);
  model.head = neck;
  if (neckLen > H * 0.3) {
    const column = mesh(capsule(W * 0.13, neckLen * 0.8), c.body, bodyGroup, L * 0.26, neckLen * 0.5, 0);
    column.rotation.z = 0.2;
  }
  mesh(sphere(W * 0.28, detail > 0.5 ? 8 : 5), c.body, neck);
  if (detail > 0.4) {
    // Beak.
    const beak = mesh(cone(W * 0.12, L * 0.3), c.accent, neck, L * 0.16, 0, 0);
    beak.rotation.z = -Math.PI / 2;
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.06, 6), c.eye, neck, W * 0.14, W * 0.08, side * W * 0.16);
    }
  }

  // Wings, which the animator flaps.
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, H * 0.12, side * W * 0.3);
    bodyGroup.add(shoulder);
    const wing = new THREE.Mesh(box(L * 0.6, H * 0.06, W * 1.5), material(c.accent));
    wing.position.z = side * W * 0.75;
    wing.castShadow = true;
    shoulder.add(wing);
    model.wings.push(shoulder);
  }

  // Tail feathers — a macaw's is longer than the rest of the bird.
  if (s.tail > 0.05) {
    const base = new THREE.Group();
    base.position.set(-L * 0.36, 0, 0);
    bodyGroup.add(base);
    const feathers = new THREE.Mesh(box(L * s.tail, H * 0.05, W * 0.5), material(c.accent));
    feathers.position.x = -L * s.tail * 0.5;
    feathers.castShadow = true;
    base.add(feathers);
    model.tail.push(base);
  }

  // Legs.
  if (detail > 0.3) {
    const legLen = def.species === Species.Heron ? H * 0.85 : H * 0.3;
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, -H * 0.28, side * W * 0.16);
      bodyGroup.add(hip);
      mesh(capsule(W * 0.05, legLen * 0.7), c.accent, hip, 0, -legLen * 0.5, 0);
      model.legs.push(hip);
    }
  }
}

/** Frogs: squat body, big hind legs, bulging eyes. */
function buildAmphibian(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const H = s.height;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = H * 0.7;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  const torso = mesh(sphere(W * 0.6, detail > 0.5 ? 8 : 5), c.body, bodyGroup);
  torso.scale.set(1.5, 0.85, 1.1);

  const head = new THREE.Group();
  head.position.set(L * 0.36, H * 0.1, 0);
  bodyGroup.add(head);
  model.head = head;
  const skull = mesh(sphere(W * 0.42, 7), c.body, head);
  skull.scale.set(1, 0.8, 1.05);
  addJaw(model, head, {
    hingeX: -W * 0.3,
    hingeY: -H * 0.06,
    length: W * 0.66,
    height: H * 0.08,
    width: W * 0.38,
    color: c.belly,
  });
  if (detail > 0.3) {
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.17, 6), c.eye, head, W * 0.16, W * 0.3, side * W * 0.3);
    }
    // Dart-frog warning patches.
    for (let i = 0; i < 4; i++) {
      const patch = mesh(
        sphere(W * 0.16, 5),
        c.accent,
        bodyGroup,
        (i - 1.5) * L * 0.2,
        W * 0.34,
        (i % 2 === 0 ? 1 : -1) * W * 0.28,
      );
      patch.scale.set(1, 0.3, 1);
    }
  }

  if (detail > 0.25) {
    // Big folded hind legs and small front ones.
    const limbs: [number, number, number][] = [
      [L * 0.22, W * 0.44, 0.5],
      [L * 0.22, -W * 0.44, 0.5],
      [-L * 0.3, W * 0.52, 1],
      [-L * 0.3, -W * 0.52, 1],
    ];
    for (const [x, z, scale] of limbs) {
      const hip = new THREE.Group();
      hip.position.set(x, -H * 0.24, z);
      bodyGroup.add(hip);
      mesh(capsule(W * 0.1 * scale, H * 0.5 * scale), c.body, hip, 0, -H * 0.22 * scale, 0);
      if (detail > 0.6) {
        const foot = mesh(box(W * 0.34 * scale, H * 0.06, W * 0.3 * scale), c.belly, hip, W * 0.1, -H * 0.46 * scale, 0);
        foot.castShadow = false;
      }
      model.legs.push(hip);
    }
  }
}

/** Tortoises and armadillos: a shell with a head poking out. */
function buildShelled(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const H = s.height;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = H * 0.6;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  // Domed shell.
  const shell = mesh(sphere(W * 0.62, detail > 0.5 ? 10 : 6), c.accent, bodyGroup, 0, H * 0.1, 0);
  shell.scale.set(L / (W * 1.24), 0.62, 1);
  // Plastron.
  mesh(box(L * 0.7, H * 0.12, W * 0.8), c.belly, bodyGroup, 0, -H * 0.24, 0);

  if (detail > 0.5) {
    // Shell plates: rings of small flattened spheres.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const plate = mesh(
        sphere(W * 0.16, 5),
        c.body,
        bodyGroup,
        Math.cos(a) * L * 0.24,
        H * 0.3,
        Math.sin(a) * W * 0.34,
      );
      plate.scale.set(1, 0.35, 1);
    }
  }

  const head = new THREE.Group();
  head.position.set(L * 0.42, -H * 0.02, 0);
  bodyGroup.add(head);
  model.head = head;
  const skull = mesh(sphere(W * 0.24, 7), c.body, head);
  skull.scale.set(1.4, 0.9, 0.9);
  addJaw(model, head, {
    hingeX: 0,
    hingeY: -H * 0.04,
    length: W * 0.3,
    height: H * 0.06,
    width: W * 0.18,
    color: c.belly,
  });
  if (detail > 0.4) {
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.05, 5), c.eye, head, W * 0.2, W * 0.08, side * W * 0.13);
    }
  }

  if (detail > 0.25) {
    const positions: [number, number][] = [
      [L * 0.24, W * 0.4],
      [L * 0.24, -W * 0.4],
      [-L * 0.24, W * 0.4],
      [-L * 0.24, -W * 0.4],
    ];
    for (const [x, z] of positions) {
      const hip = new THREE.Group();
      hip.position.set(x, -H * 0.22, z);
      bodyGroup.add(hip);
      mesh(capsule(W * 0.1, H * 0.22), c.body, hip, 0, -H * 0.14, 0);
      model.legs.push(hip);
    }
  }

  // Armadillo tail.
  if (s.tail > 0.2 && detail > 0.4) {
    const base = new THREE.Group();
    base.position.set(-L * 0.5, 0, 0);
    bodyGroup.add(base);
    const tail = new THREE.Mesh(cone(W * 0.12, L * s.tail), material(c.accent));
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -L * s.tail * 0.5;
    base.add(tail);
    model.tail.push(base);
  }
}

/** Piranhas: a flat disc with a tail. */
function buildFish(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  const torso = mesh(sphere(L * 0.42, detail > 0.5 ? 8 : 5), c.body, bodyGroup);
  torso.scale.set(1, 1.15, W / (L * 0.42) * 0.5);

  // Red belly.
  const belly = mesh(sphere(L * 0.3, 6), c.belly, bodyGroup, 0, -L * 0.16, 0);
  belly.scale.set(1, 0.6, 0.4);

  const tail = new THREE.Group();
  tail.position.x = -L * 0.4;
  bodyGroup.add(tail);
  const fin = new THREE.Mesh(cone(L * 0.28, L * 0.3), material(c.accent));
  fin.rotation.z = Math.PI / 2;
  fin.scale.set(1, 1, 0.25);
  fin.position.x = -L * 0.14;
  tail.add(fin);
  model.tail.push(tail);

  if (detail > 0.4) {
    mesh(sphere(L * 0.06, 5), c.eye, bodyGroup, L * 0.3, L * 0.08, W * 0.2);
    mesh(sphere(L * 0.06, 5), c.eye, bodyGroup, L * 0.3, L * 0.08, -W * 0.2);
  }
}

/** Butterflies: a body and two flapping wings. */
function buildInsect(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  const abdomen = mesh(capsule(L * 0.12, L * 0.5), c.body, bodyGroup);
  abdomen.rotation.z = Math.PI / 2;

  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    bodyGroup.add(hinge);
    const wing = new THREE.Mesh(box(L * 0.8, L * 0.02, W * 0.9), material(c.accent));
    wing.position.z = side * W * 0.45;
    hinge.add(wing);
    if (detail > 0.5) {
      const inner = new THREE.Mesh(box(L * 0.5, L * 0.03, W * 0.5), material(c.belly));
      inner.position.z = side * W * 0.3;
      hinge.add(inner);
    }
    model.wings.push(hinge);
  }
}

/** Free the shared caches (used when tearing the renderer down). */
export function disposeAnimalModelCaches(): void {
  for (const g of geometryCache.values()) g.dispose();
  for (const m of materialCache.values()) m.dispose();
  geometryCache.clear();
  materialCache.clear();
}

/** Diagnostics for the debug overlay. */
export function modelCacheStats(): { geometries: number; materials: number } {
  return { geometries: geometryCache.size, materials: materialCache.size };
}
