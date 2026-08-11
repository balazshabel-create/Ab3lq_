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
  /**
   * Knee joints, index-matched to `legs` — `knees[i]` is a descendant of
   * `legs[i]`, or undefined for a plan whose legs are a single segment.
   *
   * A leg that rotates as one rigid stick is the single most obvious tell that
   * an animal is a toy: real legs fold. Driving the knee from the same gait
   * phase as the hip, a quarter-cycle behind it, is what turns a pendulum swing
   * into a step — the lower leg tucks under as the foot lifts and straightens
   * again as it reaches forward to plant.
   */
  knees: (THREE.Object3D | undefined)[];
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

function capsule(r: number, len: number, radial = 8): THREE.BufferGeometry {
  const key = `cap:${r.toFixed(3)}:${len.toFixed(3)}:${radial}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.CapsuleGeometry(r, len, Math.max(3, radial >> 1), radial);
    geometryCache.set(key, g);
  }
  return g;
}

/**
 * An ellipsoid: a sphere with independent axes, cached by its final shape.
 *
 * Almost every mass on an animal is an ellipsoid rather than a sphere — a skull
 * is longer than it is wide, a haunch is deeper than it is broad, a ribcage is
 * flattened side to side. Scaling a shared sphere mesh gets the shape but breaks
 * the geometry cache's whole purpose the moment a normal needs to be right, and
 * non-uniform `Mesh.scale` skews lighting on flat-shaded facets. Baking the axes
 * into the geometry keeps one cached buffer per distinct shape and leaves the
 * normals correct.
 */
function ellipsoid(rx: number, ry: number, rz: number, segments = 8): THREE.BufferGeometry {
  const key = `ell:${rx.toFixed(3)}:${ry.toFixed(3)}:${rz.toFixed(3)}:${segments}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.SphereGeometry(1, segments, Math.max(4, segments >> 1));
    g.scale(rx, ry, rz);
    g.computeVertexNormals();
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
    knees: [],
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

/**
 * A jointed leg: hip → thigh → knee → shank → foot.
 *
 * Registers the hip in `model.legs` and the knee in `model.knees` at the same
 * index, which is the contract the animator relies on to flex the two together.
 *
 * `forward` is +1 for a foreleg and -1 for a hind leg. It flips which way the
 * knee bends, and that asymmetry is worth the parameter: a quadruped's forelegs
 * fold backwards at the wrist while the hind legs fold forwards at the hock, and
 * bending all four the same way is instantly readable as wrong even to someone
 * who could not say why.
 */
function addJointedLeg(
  model: AnimalModel,
  parent: THREE.Object3D,
  options: {
    x: number;
    y: number;
    z: number;
    length: number;
    radius: number;
    color: number;
    footColor: number;
    forward: 1 | -1;
    detail: number;
    /** Toes on the foot, for the animals that should show them. */
    toes?: number;
  },
): void {
  const { length, radius, detail, forward } = options;
  const hip = new THREE.Group();
  hip.position.set(options.x, options.y, options.z);
  parent.add(hip);

  // Thigh: the upper half, hanging from the hip.
  const thighLen = length * 0.5;
  const thigh = mesh(
    capsule(radius, thighLen * 0.72, detail > 0.5 ? 8 : 5),
    options.color,
    hip,
    0,
    -thighLen * 0.5,
    0,
  );
  thigh.castShadow = true;

  if (detail <= 0.4) {
    // Far away, one segment is enough — and the knee slot stays undefined so the
    // animator simply skips the flex rather than testing a detail level.
    model.legs.push(hip);
    model.knees.push(undefined);
    return;
  }

  // Knee: a joint group at the bottom of the thigh, with the shank below it.
  const knee = new THREE.Group();
  knee.position.set(0, -thighLen, 0);
  // Which way this joint folds, recorded here so the animator does not have to
  // guess it from the leg's index — the plans do not all order their limbs the
  // same way, and a primate's front pair are arms that fold the other way.
  knee.userData.fold = -forward;
  hip.add(knee);
  // A small mass at the joint itself, so the leg does not visibly pinch to
  // nothing where the two segments meet when the knee is bent.
  mesh(sphere(radius * 0.92, detail > 0.6 ? 7 : 5), options.color, knee);

  const shankLen = length * 0.5;
  const shank = mesh(
    capsule(radius * 0.78, shankLen * 0.7, detail > 0.5 ? 7 : 5),
    options.color,
    knee,
    0,
    -shankLen * 0.5,
    0,
  );
  shank.castShadow = true;

  // Foot, flat on the ground at the bottom of the shank.
  const footLen = radius * 2.6;
  mesh(
    box(footLen, radius * 0.7, radius * 2.1),
    options.footColor,
    knee,
    forward * radius * 0.45,
    -shankLen - radius * 0.3,
    0,
  );
  if (options.toes && detail > 0.6) {
    for (let t = 0; t < options.toes; t++) {
      const spread = (t / Math.max(1, options.toes - 1) - 0.5) * radius * 1.7;
      mesh(
        box(radius * 0.9, radius * 0.5, radius * 0.5),
        options.footColor,
        knee,
        forward * (radius * 0.45 + footLen * 0.5),
        -shankLen - radius * 0.32,
        spread,
      );
    }
  }

  model.legs.push(hip);
  model.knees.push(knee);
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

  /*
   * ## The torso is three masses, not one capsule
   *
   * A single capsule is a sausage: the same diameter from nose to tail, with no
   * shoulder, no waist and no haunch. Every animal built on this plan came out
   * looking like the same tube with different colours on it, and no amount of
   * head detail fixes a body with no anatomy in it.
   *
   * Three overlapping ellipsoids — chest, barrel, hindquarters — cost about as
   * much as the capsule did and give the silhouette a line: wide at the
   * shoulder, tucked at the waist, heavy over the back legs. That line is what
   * the eye reads as "animal", and it is what tells a jaguar (deep chest, long
   * low barrel) from a capybara (barrel almost as deep as it is long) before any
   * of the markings are visible.
   */
  const barrelR = W * 0.5;
  const torso = mesh(
    ellipsoid(L * (style === 1 ? 0.34 : 0.3), barrelR * 0.94, barrelR * (style === 1 ? 0.84 : 0.96), detail > 0.5 ? 10 : 6),
    c.body,
    bodyGroup,
  );
  torso.castShadow = true;

  if (detail > 0.4) {
    // Chest, forward and a little lower: where the forelegs hang from.
    mesh(
      ellipsoid(L * 0.19, barrelR * 0.9, barrelR * (style === 1 ? 0.82 : 0.9), detail > 0.5 ? 9 : 6),
      c.body,
      bodyGroup,
      L * 0.26,
      -H * 0.04,
      0,
    );
    // Hindquarters, heavier and set slightly higher — the push-off end.
    mesh(
      ellipsoid(L * 0.2, barrelR * 1.0, barrelR * 0.94, detail > 0.5 ? 9 : 6),
      c.body,
      bodyGroup,
      -L * 0.26,
      H * 0.02,
      0,
    );
    // Belly, a lighter underside — cheap, and it makes the silhouette read.
    const belly = mesh(capsule(W * 0.4, L * 0.44, 7), c.belly, bodyGroup, 0, -H * 0.2, 0);
    belly.rotation.z = Math.PI / 2;
    // Shoulder blades, standing a little proud of the back.
    if (detail > 0.6) {
      for (const side of [-1, 1]) {
        mesh(
          ellipsoid(L * 0.09, H * 0.12, W * 0.1, 6),
          c.body,
          bodyGroup,
          L * 0.22,
          H * 0.18,
          side * W * 0.3,
        );
      }
    }
  }

  // Head on a short neck.
  const neck = new THREE.Group();
  neck.position.set(L * 0.4, H * 0.18, 0);
  bodyGroup.add(neck);
  model.head = neck;

  // A visible neck between the chest and the skull, angled up and forward.
  if (detail > 0.4) {
    const neckMesh = mesh(
      capsule(W * 0.26, L * (style === 1 ? 0.16 : 0.12), detail > 0.5 ? 8 : 5),
      c.body,
      neck,
      -L * 0.02,
      -H * 0.02,
      0,
    );
    neckMesh.rotation.z = Math.PI / 2 - 0.5;
  }

  const skull = mesh(
    ellipsoid(W * 0.5, W * 0.4, W * 0.4, detail > 0.5 ? 10 : 5),
    c.body,
    neck,
    L * 0.1,
    0,
    0,
  );
  skull.castShadow = true;

  if (detail > 0.4) {
    /*
     * Muzzle, built as a taper rather than a box.
     *
     * The old snout was a single box stuck on the front of the skull, which from
     * the side reads as a drawer left open. Two stacked masses — a wide bridge
     * narrowing to a nose — give the head a profile, and the profile is most of
     * what distinguishes these species at the distance the game is played at.
     */
    mesh(
      ellipsoid(L * 0.09, H * 0.1, W * 0.19, detail > 0.6 ? 8 : 5),
      c.body,
      neck,
      L * 0.19,
      -H * 0.03,
      0,
    );
    // Nose pad.
    mesh(
      ellipsoid(L * 0.025, H * 0.035, W * 0.09, 6),
      c.eye,
      neck,
      L * 0.27,
      -H * 0.01,
      0,
    );
    // Brow ridge: a shelf over the eyes. Small, and it does more for a face than
    // anything else here — it is what stops the head reading as a smooth egg.
    if (detail > 0.6) {
      for (const side of [-1, 1]) {
        mesh(
          ellipsoid(W * 0.13, W * 0.06, W * 0.11, 6),
          c.body,
          neck,
          L * 0.13,
          H * 0.11,
          side * W * 0.2,
        );
      }
    }

    addJaw(model, neck, {
      hingeX: L * 0.1,
      hingeY: -H * 0.11,
      length: L * 0.19,
      height: H * 0.08,
      width: W * 0.32,
      color: c.belly,
    });

    // Ears, with a darker inner surface set into the cone.
    for (const side of [-1, 1]) {
      const ear = mesh(cone(W * 0.13, H * 0.24), c.accent, neck, L * 0.02, W * 0.32, side * W * 0.25);
      ear.rotation.x = side * 0.25;
      if (detail > 0.6) {
        const inner = mesh(cone(W * 0.08, H * 0.17), c.eye, neck, L * 0.035, W * 0.31, side * W * 0.25);
        inner.rotation.x = side * 0.25;
      }
    }

    // Eyes, with a pupil in front of the eyeball. Two spheres, and the animal
    // suddenly has somewhere it is looking.
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.085, 7), c.eye, neck, L * 0.16, H * 0.06, side * W * 0.235);
      if (detail > 0.6) {
        mesh(sphere(W * 0.04, 5), 0x0d0b09, neck, L * 0.185, H * 0.065, side * W * 0.245);
      }
    }

    // Whiskers on the cats: four fine bristles a side, and they read from
    // surprisingly far away because nothing else on the model is a straight line.
    if (style === 1 && detail > 0.7) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const whisker = mesh(
            box(L * 0.11, W * 0.012, W * 0.012),
            c.belly,
            neck,
            L * 0.25,
            -H * 0.02 + i * H * 0.025,
            side * W * 0.13,
          );
          whisker.rotation.y = side * (0.5 + i * 0.16);
        }
      }
    }
  }

  // Legs. Front pair slightly forward of centre, back pair behind.
  if (detail > 0.25) {
    const legLen = H * 0.92;
    const legR = W * 0.13;
    const positions: [number, number, 1 | -1][] = [
      [L * 0.3, W * 0.32, 1],
      [L * 0.3, -W * 0.32, 1],
      [-L * 0.3, W * 0.34, -1],
      [-L * 0.3, -W * 0.34, -1],
    ];
    for (const [x, z, forward] of positions) {
      addJointedLeg(model, bodyGroup, {
        x,
        y: -H * 0.1,
        z,
        length: legLen,
        radius: legR,
        color: c.body,
        footColor: c.accent,
        forward,
        detail,
        toes: style === 1 ? 3 : 0,
      });
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

  /*
   * Jaguar and ocelot rosettes.
   *
   * The old version stepped one angle around a circle and used it for both the
   * position along the body and the position around it, so the spots traced a
   * single helix — from most angles a tidy diagonal stripe, which is a marking
   * no cat has. Rows down the flank, offset half a step from each other and
   * jittered by a fixed hash, scatter properly.
   *
   * They are placed on both flanks and along the spine, pressed flat against the
   * body so they read as markings rather than as lumps, and they are slightly
   * *inside* the surface: a spot floating a millimetre proud z-fights, and a
   * flat-shaded facet makes that painfully visible.
   */
  if (style === 1 && detail > 0.6) {
    const rows = 3;
    const perRow = 5;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < perRow; i++) {
        // A cheap deterministic jitter, so the grid does not read as a grid.
        const j = Math.sin((r * 13.7 + i * 7.3) * 12.9898) * 43758.5453;
        const jitter = j - Math.floor(j);
        const along = ((i + (r % 2) * 0.5 + jitter * 0.4) / perRow - 0.45) * L * 0.82;
        // Row 0 sits over the spine, rows 1–2 down each flank.
        const ring = -0.35 + r * 0.62 + jitter * 0.2;
        for (const side of [-1, 1]) {
          if (r === 0 && side < 0) continue; // the spine row exists once
          const y = Math.cos(ring) * barrelR * 0.9;
          const z = side * Math.sin(ring) * barrelR * 0.86;
          const spot = mesh(
            ellipsoid(W * 0.07 + jitter * W * 0.03, W * 0.055, W * 0.07, 5),
            c.accent,
            bodyGroup,
            along,
            y,
            z,
          );
          // Flatten onto the surface and face outwards.
          spot.lookAt(spot.position.x, spot.position.y * 3, spot.position.z * 3);
          spot.scale.set(1, 1, 0.35);
        }
      }
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

  /*
   * Sprawling legs, with an elbow.
   *
   * A crocodilian's limb geometry is the opposite of a mammal's: the upper
   * segment goes *outwards* almost horizontally and the lower one drops
   * vertically to the foot, which is what produces the wide-track, belly-low
   * stance. Building that as one straight capsule leaning outwards gave four
   * splayed sticks and the animal sat on its chin.
   *
   * So the hip carries a near-horizontal humerus and the elbow group under it
   * carries a vertical forearm and a clawed foot. The elbow goes into
   * `model.knees` like any other, so the walk cycle flexes it for free.
   */
  if (detail > 0.25) {
    const positions: [number, number][] = [
      [L * 0.26, W * 0.42],
      [L * 0.26, -W * 0.42],
      [-L * 0.24, W * 0.44],
      [-L * 0.24, -W * 0.44],
    ];
    for (const [x, z] of positions) {
      const side = Math.sign(z);
      const hip = new THREE.Group();
      hip.position.set(x, -H * 0.16, z);
      bodyGroup.add(hip);

      // Humerus: out to the side and slightly down.
      const upper = mesh(capsule(W * 0.1, H * 0.3, detail > 0.5 ? 7 : 5), c.body, hip, 0, -H * 0.16, side * W * 0.12);
      upper.rotation.x = -side * 0.9;
      upper.castShadow = true;

      if (detail <= 0.4) {
        model.legs.push(hip);
        model.knees.push(undefined);
        continue;
      }

      const elbow = new THREE.Group();
      elbow.position.set(0, -H * 0.3, side * W * 0.24);
      // Front pair fold back, rear pair fold forward — same convention as the
      // mammal legs, so the animator needs no special case for reptiles.
      elbow.userData.fold = x > 0 ? -1 : 1;
      hip.add(elbow);
      const lower = mesh(capsule(W * 0.082, H * 0.26, detail > 0.5 ? 7 : 5), c.body, elbow, 0, -H * 0.16, 0);
      lower.castShadow = true;
      // Foot, splayed flat.
      mesh(box(W * 0.26, H * 0.06, W * 0.3), c.belly, elbow, W * 0.04, -H * 0.32, 0);
      // Claws.
      if (detail > 0.6) {
        for (let t = -1; t <= 1; t++) {
          mesh(
            cone(W * 0.028, W * 0.09),
            c.accent,
            elbow,
            W * 0.17,
            -H * 0.32,
            t * W * 0.09,
          ).rotation.z = -Math.PI / 2;
        }
      }
      model.legs.push(hip);
      model.knees.push(elbow);
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
      const len = isArm ? H * 0.9 : H * 0.8;
      addJointedLeg(model, bodyGroup, {
        x,
        y: isArm ? H * 0.1 : -H * 0.12,
        z,
        length: len,
        radius: W * 0.11,
        color: c.body,
        // Bare hands and feet, paler than the coat — a monkey's most recognisable
        // detail after its tail, and it costs one colour.
        footColor: c.accent,
        // Arms fold the other way from legs, which is the whole point of an arm.
        forward: isArm ? -1 : 1,
        detail,
        toes: 3,
      });
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

  /*
   * Scutes: the plated pattern that makes a shell a shell.
   *
   * The old version put seven flattened spheres in a single ring at one height,
   * which from directly above — the angle this game is usually played from —
   * reads as a daisy, and from the side as a lumpy seam. A tortoise's carapace
   * is a central row of vertebral scutes flanked by two rows of costals, and
   * laying them out that way is what turns a smooth dome into something that
   * looks armoured.
   */
  if (detail > 0.5) {
    const rowY = [H * 0.38, H * 0.3, H * 0.16];
    const rowZ = [0, W * 0.32, W * 0.5];
    for (let row = 0; row < 3; row++) {
      const along = row === 0 ? 5 : 4;
      for (let i = 0; i < along; i++) {
        const x = ((i + 0.5) / along - 0.5) * L * 0.72;
        for (const side of [-1, 1]) {
          if (row === 0 && side < 0) continue; // the vertebral row exists once
          const plate = mesh(
            ellipsoid(L * 0.1, H * 0.07, W * (row === 0 ? 0.15 : 0.13), 6),
            row === 0 ? c.body : c.belly,
            bodyGroup,
            x,
            rowY[row],
            side * rowZ[row],
          );
          plate.scale.set(1, 1, 1);
        }
      }
    }
    // A rim around the lower edge of the carapace, which is what gives a shell
    // its overhang instead of letting the dome fade straight into the legs.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      mesh(
        ellipsoid(L * 0.07, H * 0.05, W * 0.08, 5),
        c.accent,
        bodyGroup,
        Math.cos(a) * L * 0.44,
        H * 0.02,
        Math.sin(a) * W * 0.56,
      );
    }
  }

  const head = new THREE.Group();
  head.position.set(L * 0.42, -H * 0.02, 0);
  bodyGroup.add(head);
  model.head = head;
  const skull = mesh(ellipsoid(W * 0.34, W * 0.21, W * 0.22, detail > 0.5 ? 9 : 6), c.body, head);
  skull.castShadow = true;
  // A scaly neck, drawn out of the shell.
  if (detail > 0.4) {
    const neck = mesh(capsule(W * 0.15, W * 0.22, 7), c.body, head, -W * 0.24, -W * 0.03, 0);
    neck.rotation.z = Math.PI / 2;
  }
  addJaw(model, head, {
    hingeX: 0,
    hingeY: -H * 0.04,
    length: W * 0.3,
    height: H * 0.06,
    width: W * 0.18,
    color: c.belly,
  });
  if (detail > 0.4) {
    // A beak: the hooked upper lip that every tortoise has, and the one feature
    // that stops the head reading as a thumb.
    mesh(ellipsoid(W * 0.09, W * 0.07, W * 0.1, 6), c.accent, head, W * 0.3, -W * 0.03, 0);
    for (const side of [-1, 1]) {
      mesh(sphere(W * 0.055, 6), c.eye, head, W * 0.2, W * 0.08, side * W * 0.15);
      if (detail > 0.6) mesh(sphere(W * 0.026, 5), 0x0d0b09, head, W * 0.235, W * 0.085, side * W * 0.16);
    }
  }

  if (detail > 0.25) {
    const positions: [number, number, 1 | -1][] = [
      [L * 0.24, W * 0.4, 1],
      [L * 0.24, -W * 0.4, 1],
      [-L * 0.24, W * 0.4, -1],
      [-L * 0.24, -W * 0.4, -1],
    ];
    for (const [x, z, forward] of positions) {
      addJointedLeg(model, bodyGroup, {
        x,
        y: -H * 0.22,
        z,
        length: H * 0.44,
        radius: W * 0.11,
        color: c.body,
        footColor: c.accent,
        forward,
        detail,
        // Stumpy clawed feet: the elephantine forefoot is the tortoise read.
        toes: 3,
      });
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
