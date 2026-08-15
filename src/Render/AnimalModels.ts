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
  Diet,
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
  /**
   * Muzzle flash at the end of the hunter's barrel, hidden except for the two
   * or three frames after a shot. Null for everything that does not carry a gun.
   */
  muzzle: THREE.Object3D | null;
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
    muzzle: null,
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
      // The great apes get their own builder. A gorilla and a howler monkey
      // share a body plan on paper and nothing at all in silhouette, and running
      // the gorilla through the monkey builder produced a black sausage on four
      // sticks — see buildApe.
      if (def.species === Species.Gorilla) buildApe(model, def, detail);
      else buildPrimate(model, def, detail);
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
    case BodyPlan.Human:
      buildHuman(model, def, detail);
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

  /*
   * Foot, flat on the ground at the bottom of the shank.
   *
   * Kept close to the width of the leg. At 2.6 radii long it projected well past
   * the ankle and read as a flipper — a paw is about as long as the leg is
   * thick, and anything more turns a cat into a duck.
   */
  const footLen = radius * 1.9;
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

/**
 * A tapering, segmented tail that cannot come apart.
 *
 * ## The bug this exists to make impossible
 *
 * Every body plan grew its own tail loop, and every one of them had the same
 * two defects. The base was anchored past the end of the torso, so the tail
 * started in mid-air behind the animal; and each segment's mesh was built at a
 * fixed *fraction* of the slot it occupied while its radius shrank down the
 * taper, so the gaps between segments grew towards the tip. The result — three
 * detached blobs trailing a tiger, and a caiman in four pieces — was plainly
 * visible in any screenshot and had survived a long time, because a tail is the
 * part of an animal nobody looks at directly.
 *
 * Both are structural, so they are fixed structurally rather than by nudging
 * numbers. Each segment is an ellipsoid whose half-length is *longer* than its
 * slot, so consecutive segments always overlap however far the taper has gone;
 * and callers pass the anchor as a point that is inside the body, because a
 * tail that begins under the rump is invisible and a tail that begins behind it
 * is a mistake you can see from fifty metres.
 */
function addTail(
  model: AnimalModel,
  parent: THREE.Object3D,
  options: {
    /** Where the tail leaves the body. Put it *inside* the hindquarters. */
    x: number;
    y: number;
    z?: number;
    length: number;
    segments: number;
    /** Cross-section at the root and at the tip, vertical then lateral. */
    rootY: number;
    rootZ: number;
    tipY: number;
    tipZ: number;
    color: number;
    detail: number;
    /** Radians of droop per segment. Negative lifts the tail. */
    droop?: number;
    /** Hook for per-segment decoration — scutes, tufts, a tip. */
    decorate?: (segment: THREE.Object3D, index: number, radius: number, segLen: number) => void;
  },
): void {
  const { segments, detail } = options;
  if (segments < 1 || options.length <= 0) return;

  const segLen = options.length / segments;
  const base = new THREE.Group();
  base.position.set(options.x, options.y, options.z ?? 0);
  parent.add(base);

  let node: THREE.Object3D = base;
  for (let i = 0; i < segments; i++) {
    const g = new THREE.Group();
    g.position.x = i === 0 ? 0 : -segLen;
    // The first joint droops half as far, so the tail leaves the body along it
    // rather than kinking away from it.
    g.rotation.z = (options.droop ?? 0) * (i === 0 ? 0.5 : 1);
    node.add(g);

    // Sample the taper at the middle of this slot, not at its start: sampling at
    // the start makes the last segment a stub of the wrong width.
    const t = (i + 0.5) / segments;
    const ry = options.rootY + (options.tipY - options.rootY) * t;
    const rz = options.rootZ + (options.tipZ - options.rootZ) * t;

    const seg = mesh(
      ellipsoid(segLen * 0.66, ry, rz, detail > 0.5 ? 8 : 5),
      options.color,
      g,
      -segLen * 0.5,
      0,
      0,
    );
    seg.castShadow = true;
    options.decorate?.(g, i, Math.max(ry, rz), segLen);

    model.tail.push(g);
    node = g;
  }
}

/**
 * A shell of fur tufts over a body.
 *
 * ## Why silhouette is the whole game here
 *
 * Every mammal on this plan was a set of smooth ellipsoids, and smooth
 * ellipsoids read as plastic no matter what colour you paint them. Fur cannot be
 * done with a texture in this project — there are no texture assets at all — but
 * it does not need to be, because at the distance the game is played the thing
 * the eye actually reads as "furry" is a *broken outline*: a coat is legible
 * from the ragged edge it puts on the silhouette, not from any detail inside it.
 *
 * So this scatters flattened, tapered tufts over the surface of an ellipsoid,
 * each tilted outwards along its own normal. From outside they break the
 * outline; from any angle they catch light differently from the body under
 * them. Cheap — four triangles each — and applied only at full detail, since a
 * distant animal is a few pixels wide and has no silhouette to break.
 *
 * Points are placed on a Fibonacci sphere, which spreads them evenly without any
 * of the clumping at the poles that stepping latitude and longitude produces.
 */
function addFur(
  parent: THREE.Object3D,
  options: {
    rx: number;
    ry: number;
    rz: number;
    count: number;
    length: number;
    colors: number[];
    /** Only cover the upper half, for animals with a bare belly. */
    topOnly?: boolean;
    centre?: [number, number, number];
  },
): void {
  const { rx, ry, rz, count, length, colors } = options;
  const [cx, cy, cz] = options.centre ?? [0, 0, 0];
  for (let i = 0; i < count; i++) {
    // Fibonacci sphere: even coverage, no polar clumping.
    const y = 1 - (i / (count - 1)) * 2;
    if (options.topOnly && y < -0.15) continue;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * 2.399963;
    const nx = Math.cos(theta) * r;
    const nz = Math.sin(theta) * r;

    // A deterministic wobble, so the coat is not a lattice.
    const h = Math.sin((i * 12.9898 + 78.233) * 43758.5453);
    const jitter = h - Math.floor(h);
    const len = length * (0.7 + jitter * 0.7);

    /*
     * The long axis has to be Z, not X.
     *
     * `Object3D.lookAt` aims local **+Z** at the target, so a tuft whose length
     * runs along local X ends up lying flat against the body — tangential, half
     * buried, and contributing nothing to the outline. That is exactly what the
     * first version did, and the coat was invisible: the animal still read as
     * smooth plastic while the triangles were all being drawn.
     *
     * Built long in Z and aimed outward along the surface normal, each tuft
     * sticks out of the body instead.
     */
    /*
     * Thin. A tuft half as wide as it is long is a plank, and ninety planks
     * standing off a capybara's back read as a pile of broken crates rather than
     * as a coat — which is exactly how the first shaggy animals came out. Hair
     * is essentially one-dimensional; what makes a coat legible is the *number*
     * of edges breaking the outline, not the area of each one.
     */
    const tuft = mesh(
      box(len * 0.2, len * 0.12, len),
      colors[i % colors.length],
      parent,
      // Base slightly inside the surface, so no tuft floats free of the body.
      cx + nx * rx * 0.88,
      cy + y * ry * 0.88,
      cz + nz * rz * 0.88,
    );
    tuft.lookAt(cx + nx * rx * 2.6, cy + y * ry * 2.6, cz + nz * rz * 2.6);
    // Then lie it back along the body: fur sweeps, it does not stand on end.
    tuft.rotateX(0.5 + jitter * 0.5);
    tuft.castShadow = false;
  }
}

/**
 * A row of teeth along a jaw, pointing up or down.
 *
 * `direction` is -1 for an upper row hanging down and +1 for a lower row
 * standing up. Rows on opposing jaws should be given different `count`s or a
 * half-step offset so they interlock rather than collide.
 */
function addTeeth(
  parent: THREE.Object3D,
  options: {
    count: number;
    fromX: number;
    toX: number;
    y: number;
    spread: number;
    size: number;
    direction: 1 | -1;
  },
): void {
  const { count, fromX, toX, y, spread, size, direction } = options;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    // Canines at the front, smaller cheek teeth behind.
    const scale = 1 - t * 0.5;
    for (const side of [-1, 1]) {
      const tooth = mesh(
        cone(size * 0.42 * scale, size * 2 * scale),
        0xf4efe3,
        parent,
        fromX + (toX - fromX) * t,
        y,
        side * spread * (1 - t * 0.25),
      );
      if (direction < 0) tooth.rotation.x = Math.PI;
    }
  }
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
  /*
   * The three masses are described as data before anything is built, because
   * the markings later on have to know where the surface actually *is*.
   *
   * Painting stripes at a single guessed radius does not work: the barrel is a
   * union of three ellipsoids of different widths, so one radius is inside the
   * body over the ribs and outside it over the shoulder. The first attempt at
   * tiger stripes did exactly that and came out as a scatter of black chips
   * where the guess happened to break the surface. With the masses in a table,
   * `surfaceAt` can find the widest one at any point along the body and put the
   * marking on it.
   */
  type Mass = { cx: number; cy: number; rx: number; ry: number; rz: number };
  const masses: Mass[] = [
    {
      cx: 0,
      cy: 0,
      rx: L * (style === 1 ? 0.34 : 0.3),
      ry: barrelR * 0.94,
      rz: barrelR * (style === 1 ? 0.84 : 0.96),
    },
  ];
  if (detail > 0.4) {
    // Chest, forward and a little lower: where the forelegs hang from.
    masses.push({
      cx: L * 0.26,
      cy: -H * 0.04,
      rx: L * 0.19,
      ry: barrelR * 0.9,
      rz: barrelR * (style === 1 ? 0.82 : 0.9),
    });
    // Hindquarters, heavier and set slightly higher — the push-off end.
    masses.push({ cx: -L * 0.26, cy: H * 0.02, rx: L * 0.2, ry: barrelR, rz: barrelR * 0.94 });
  }

  for (let i = 0; i < masses.length; i++) {
    const m = masses[i];
    const seg = detail > 0.5 ? (i === 0 ? 10 : 9) : 6;
    const piece = mesh(ellipsoid(m.rx, m.ry, m.rz, seg), c.body, bodyGroup, m.cx, m.cy, 0);
    piece.castShadow = true;
  }

  /** The widest mass at this point along the body, or null past both ends. */
  const surfaceAt = (along: number): Mass | null => {
    let best: Mass | null = null;
    let bestR = 0;
    for (const m of masses) {
      const t = (along - m.cx) / m.rx;
      if (Math.abs(t) >= 1) continue;
      const shrink = Math.sqrt(1 - t * t);
      if (m.rz * shrink > bestR) {
        bestR = m.rz * shrink;
        best = m;
      }
    }
    return best;
  };

  if (detail > 0.4) {
    /*
     * Belly, a lighter underside.
     *
     * Tucked *into* the barrel rather than slung under it. At its old radius and
     * height it hung a hand's width below the torso and read as a grey slab
     * bolted to the animal's underside — a shelf, from any angle but head-on.
     * An underside is a colour change on the bottom of a body, so it has to sit
     * inside the body's own silhouette and only show where the light does not
     * reach.
     */
    const belly = mesh(
      ellipsoid(L * 0.26, barrelR * 0.5, barrelR * 0.58, detail > 0.5 ? 9 : 5),
      c.belly,
      bodyGroup,
      0,
      -barrelR * 0.5,
      0,
    );
    belly.castShadow = false;
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

  /*
   * The coat.
   *
   * Only at full detail, and only over the barrel — the tufts are there to break
   * the silhouette, and a distant animal has no silhouette to break while a
   * fully furred head turns into a hairball. Cats get a short, tight coat; the
   * shaggy ones (anteater, sloth, capybara) get a longer, looser one, which is
   * most of what tells them apart at a glance now that they share a body plan.
   */
  if (detail >= 1) {
    const shaggy =
      def.species === Species.Anteater ||
      def.species === Species.Sloth ||
      def.species === Species.Capybara ||
      def.species === Species.Peccary;
    addFur(bodyGroup, {
      rx: L * 0.32,
      ry: barrelR * 0.92,
      rz: barrelR * (style === 1 ? 0.82 : 0.94),
      count: shaggy ? 130 : 96,
      length: (shaggy ? 0.24 : 0.17) * W,
      // Coat colours only. A cream tuft on a tiger's back reads as a chip of
      // bone stuck to it, because a tiger's pale fur is on its underside.
      colors: [c.body, c.accent, c.body],
      topOnly: true,
    });
    /*
     * A ruff at the throat and a longer guard coat along the spine.
     *
     * The coat over the barrel alone leaves the join between neck and shoulder
     * as a hard seam, which is the one place a procedural animal most obviously
     * gives itself away as two shapes pushed together. Cats especially carry a
     * visible thickening there, and it costs a second call.
     */
    addFur(bodyGroup, {
      rx: L * 0.12,
      ry: barrelR * 0.7,
      rz: barrelR * 0.78,
      count: 46,
      length: (shaggy ? 0.22 : 0.16) * W,
      // Coat colours only. A pale tuft in the ruff reads as a chip of bone
      // stuck to the animal's neck, not as fur catching the light.
      colors: [c.body, c.accent, c.body],
      centre: [L * 0.3, 0, 0],
    });
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
    /*
     * The muzzle itself carries the pale colour, rather than a patch laid over
     * it. A patch has to be bigger than the mass underneath to be seen at all,
     * and one big enough to win ends up looking like a growth; recolouring the
     * mass costs nothing and is what a pale muzzle actually is.
     */
    mesh(
      ellipsoid(L * 0.09, H * 0.1, W * 0.19, detail > 0.6 ? 8 : 5),
      style === 1 ? c.belly : c.body,
      neck,
      L * 0.19,
      -H * 0.03,
      0,
    );
    /*
     * Nose pad, in the *accent* colour.
     *
     * It was using `c.eye`, which on a tiger is a yellow-green — so the animal
     * had a lime nose. An easy thing to write and an impossible thing to miss
     * once you look at the face straight on, which is exactly the angle a player
     * spends the whole round looking at other animals from.
     */
    mesh(
      ellipsoid(L * 0.025, H * 0.035, W * 0.09, 6),
      c.accent,
      neck,
      L * 0.27,
      -H * 0.01,
      0,
    );
    /*
     * Markings on the face, placed on the *surface* of the skull.
     *
     * The first attempt put them at hand-picked coordinates and every one of
     * them ended up inside the head — the skull is an ellipsoid a third of a
     * metre across and anything placed by eye at "roughly the forehead" is
     * comfortably within it. Same lesson as the body stripes: a marking has to
     * be positioned from the shape it is marking, not from a guess.
     *
     * `dir` is a direction from the skull's centre; the mark lands where that
     * direction leaves the ellipsoid.
     */
    const skullCentre: [number, number, number] = [L * 0.1, 0, 0];
    const skullR: [number, number, number] = [W * 0.5, W * 0.4, W * 0.4];
    const markOnSkull = (
      dir: [number, number, number],
      size: [number, number, number],
      color: number,
      rotX = 0,
    ): void => {
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const m = mesh(
        ellipsoid(size[0], size[1], size[2], 5),
        color,
        neck,
        skullCentre[0] + (dir[0] / len) * skullR[0] * 0.94,
        skullCentre[1] + (dir[1] / len) * skullR[1] * 0.94,
        skullCentre[2] + (dir[2] / len) * skullR[2] * 0.94,
      );
      m.rotation.x = rotX;
      m.castShadow = false;
    };

    if (detail > 0.5) {
      // A pale muzzle and pale cheeks. A head of one colour is an egg however
      // many masses are in it, because nothing inside the outline catches the
      // light differently.
      // Pale jowls, low and forward on the cheek. Set any higher or wider and
      // they read as a pair of earmuffs.
      for (const side of [-1, 1]) {
        markOnSkull([0.7, -0.75, side * 0.8], [W * 0.09, W * 0.07, W * 0.07], c.belly);
      }
    }

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

    /*
     * The lower jaw, in coat colour rather than in belly colour. A cream box
     * under the muzzle reads as something the animal is carrying, not as part of
     * its head — the pale underside belongs on the *throat*, below the jaw, and
     * that is where it goes now.
     */
    addJaw(model, neck, {
      hingeX: L * 0.1,
      hingeY: -H * 0.105,
      length: L * 0.155,
      height: H * 0.065,
      width: W * 0.26,
      color: c.body,
    });
    if (detail > 0.6) {
      const chin = mesh(
        ellipsoid(L * 0.07, H * 0.045, W * 0.16, 6),
        c.belly,
        neck,
        L * 0.09,
        -H * 0.15,
        0,
      );
      chin.castShadow = false;
    }

    /*
     * Teeth, for the animals that have a bite worth showing.
     *
     * Gated on diet rather than on body plan: a jaguar and a capybara share this
     * builder, and a capybara with canines is a different animal. The lower row
     * hangs off the hinged jaw so a bite opens a gap between the rows, which is
     * what makes the attack animation land.
     */
    const carnivore = def.diet === Diet.Carnivore || def.diet === Diet.Omnivore;
    if (carnivore && detail > 0.7) {
      addTeeth(neck, {
        count: 4,
        fromX: L * 0.25,
        toX: L * 0.13,
        y: -H * 0.1,
        spread: W * 0.13,
        size: W * 0.075,
        direction: -1,
      });
      if (model.jaw) {
        addTeeth(model.jaw, {
          count: 3,
          fromX: L * 0.16,
          toX: L * 0.07,
          y: -H * 0.02,
          spread: W * 0.11,
          size: W * 0.06,
          direction: 1,
        });
      }
    }

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
    /*
     * The eye, in three parts.
     *
     * A dark socket behind it so it sits *in* the skull rather than on it; a
     * pale surround outside that; and a pupil in front. The surround is the part
     * that was missing and the part that matters most: half this roster has a
     * near-black iris on a dark brown head, so the eye had nothing to be seen
     * against and the face came out blind. Almost every mammal has paler fur
     * ringing the eye, and here it is the difference between a face and a box.
     */
    for (const side of [-1, 1]) {
      if (detail > 0.6) {
        mesh(ellipsoid(W * 0.15, W * 0.13, W * 0.05, 6), c.belly, neck, L * 0.14, H * 0.06, side * W * 0.23);
        mesh(ellipsoid(W * 0.115, W * 0.095, W * 0.05, 6), c.accent, neck, L * 0.152, H * 0.06, side * W * 0.236);
      }
      mesh(sphere(W * 0.088, 7), c.eye, neck, L * 0.168, H * 0.06, side * W * 0.242);
      if (detail > 0.6) {
        mesh(sphere(W * 0.042, 5), 0x0d0b09, neck, L * 0.196, H * 0.065, side * W * 0.25);
      }
    }

    /*
     * Facial markings.
     *
     * A tiger's face carries more pattern than the rest of it — bars across the
     * forehead and a fan of them down each cheek — and a striped animal with a
     * blank face reads as a different species from the neck up. Placed on the
     * skull by angle rather than by hand so they follow its curve.
     */
    if (detail > 0.6 && (def.species === Species.Tiger || def.species === Species.Leopard)) {
      const striped = def.species === Species.Tiger;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          // Bars across the forehead, fanning back over the skull.
          markOnSkull(
            [0.5 - i * 0.28, 1, side * (0.25 + i * 0.3)],
            striped ? [W * 0.035, W * 0.03, W * 0.09] : [W * 0.045, W * 0.03, W * 0.045],
            c.accent,
            side * 0.6,
          );
          // Cheek marks, fanning back from the muzzle.
          markOnSkull(
            [0.85 - i * 0.25, -0.35 - i * 0.2, side],
            striped ? [W * 0.07, W * 0.025, W * 0.03] : [W * 0.04, W * 0.03, W * 0.04],
            c.accent,
          );
        }
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

  /*
   * Legs.
   *
   * Thicker and set wider than they were. A big cat's foreleg is about as thick
   * as its own head, and at the old radius the tiger stood on four pencils —
   * which reads as a toy horse no matter how good the body is. The front pair
   * also sit further forward, under the shoulder rather than behind it, because
   * the chest hanging out past its own legs is the other half of that look.
   */
  if (detail > 0.25) {
    const legLen = H * 0.92;
    const legR = W * (style === 1 ? 0.17 : 0.155);
    const positions: [number, number, 1 | -1][] = [
      [L * 0.33, W * 0.36, 1],
      [L * 0.33, -W * 0.36, 1],
      [-L * 0.31, W * 0.38, -1],
      [-L * 0.31, -W * 0.38, -1],
    ];
    for (const [x, z, forward] of positions) {
      addJointedLeg(model, bodyGroup, {
        x,
        y: -H * 0.08,
        z,
        length: legLen,
        radius: legR,
        color: c.body,
        footColor: c.body,
        forward,
        detail,
        toes: style === 1 ? 4 : 0,
      });
      /*
       * The upper leg, where it meets the body: a shoulder on the front pair and
       * a haunch on the back. Attached to the hip group so it swings with the
       * limb, which is what a shoulder does and what makes the gait read as
       * driven from the body rather than from the ankle.
       */
      if (detail > 0.5) {
        const hip = model.legs[model.legs.length - 1];
        const mass = mesh(
          ellipsoid(
            legR * (forward > 0 ? 1.5 : 1.9),
            legLen * 0.3,
            legR * 1.45,
            detail > 0.7 ? 8 : 5,
          ),
          c.body,
          hip,
          forward > 0 ? -legR * 0.15 : -legR * 0.35,
          -legLen * 0.16,
          0,
        );
        mass.castShadow = true;
      }
      /*
       * Leg bands.
       *
       * A tiger is striped to the toes and a leopard is spotted to them, and a
       * patterned body on four plain legs is the sort of thing you cannot
       * un-see once you have noticed it. Attached to the hip so they swing with
       * the limb rather than staying behind on the body.
       */
      if (detail > 0.7 && style === 1) {
        const hip = model.legs[model.legs.length - 1];
        const spotted = def.species === Species.Leopard;
        for (let b = 0; b < 4; b++) {
          const y = -legLen * (0.16 + b * 0.19);
          const ring = spotted ? [0.6, 2.4, 4.2] : [0, 1.05, 2.1, 3.14, 4.2, 5.25];
          for (const around of ring) {
            const j = Math.abs(Math.sin(b * 12.9 + around * 7.7));
            mesh(
              ellipsoid(legR * (spotted ? 0.34 : 0.42), legR * 0.26, legR * 0.42, 5),
              c.accent,
              hip,
              Math.cos(around) * legR * 0.86,
              y - j * legLen * 0.03,
              Math.sin(around) * legR * 0.86,
            );
          }
        }
      }

      // Claws, on the animals that have any use for them.
      if (detail > 0.7 && (def.diet === Diet.Carnivore || def.diet === Diet.Omnivore)) {
        const knee = model.knees[model.knees.length - 1];
        if (knee) {
          /*
           * Claws, tucked under the toes rather than projecting past them.
           * At half a leg-radius long and sticking out in front of the foot they
           * read as flippers — a cat's claws are sheathed, and what you see of
           * them is a hint at the front of the paw, not a set of blades.
           */
          for (let t = 0; t < 3; t++) {
            const claw = mesh(
              cone(legR * 0.1, legR * 0.28),
              c.belly,
              knee,
              forward * legR * 0.45 + legR * 1.1,
              -legLen * 0.5 - legR * 0.42,
              (t - 1) * legR * 0.52,
            );
            claw.rotation.z = -Math.PI / 2 + 0.9;
          }
        }
      }
    }
  }

  // Tail. Anchored inside the hindquarters — see addTail.
  if (s.tail > 0.05 && detail > 0.4) {
    addTail(model, bodyGroup, {
      x: -L * 0.42,
      y: H * 0.1,
      length: L * s.tail,
      segments: style === 1 ? 5 : 2,
      rootY: W * 0.13,
      rootZ: W * 0.13,
      tipY: W * 0.05,
      tipZ: W * 0.05,
      color: c.body,
      detail,
      // Cats carry the tail low with a lift at the tip; the stubby ones just
      // hang. A dead-straight tail is the tell of a model with no weight in it.
      droop: style === 1 ? 0.16 : 0.28,
      decorate: (segment, index, radius) => {
        // A dark tip, and rings on the way to it. Both are free silhouette.
        if (style !== 1 || detail < 0.7) return;
        if (index % 2 === 1) {
          const ring = mesh(ellipsoid(radius * 0.5, radius * 1.1, radius * 1.1, 6), c.accent, segment);
          ring.position.x = -radius * 0.4;
        }
      },
    });
  }

  /*
   * --- Markings ----------------------------------------------------------
   *
   * A tiger and a leopard shared this builder and both came out covered in
   * rosettes, which is the single loudest thing you can get wrong about a big
   * cat: a striped animal and a spotted one do not look alike at *any*
   * distance, and telling one player's species from another at range is
   * gameplay here, not decoration.
   *
   * Both are painted the same way — small flattened ellipsoids set very
   * slightly inside the barrel's surface and turned to face outwards. Sitting
   * proud of the surface z-fights, and on flat-shaded facets that is violently
   * obvious.
   */
  /*
   * `ring` is the angle around the barrel: 0 is the spine, π/2 is the flank.
   *
   * The orientation here is done with an explicit rotation about X rather than
   * with `lookAt`, and that is the entire reason the stripes work. `lookAt`
   * turns the *whole* local frame to face outwards, which means the ellipsoid's
   * long axis ends up pointing wherever the roll happens to leave it — so a
   * marking built long-and-thin came out as a blob at an arbitrary angle. It
   * went unnoticed while the only markings were rosettes, because a rosette is
   * round and a rotated circle is a circle. A stripe is not.
   *
   * Rotating about X keeps the marking's X axis along the body's length (so
   * "narrow" stays narrow front-to-back) and swings its Y/Z into the tangent and
   * the outward normal, which is exactly the freedom a marking on a cylinder
   * needs and no more.
   */
  const markOnBody = (
    along: number,
    ring: number,
    side: number,
    rx: number,
    tangential: number,
    color: number,
  ): void => {
    const mass = surfaceAt(along);
    if (!mass) return;
    const t = (along - mass.cx) / mass.rx;
    const shrink = Math.sqrt(Math.max(0, 1 - t * t));
    // Straddle the surface: mostly buried, a few millimetres proud. Fully
    // buried is invisible and fully proud reads as a welt.
    const y = mass.cy + Math.cos(ring) * mass.ry * shrink * 0.97;
    const z = side * Math.sin(ring) * mass.rz * shrink * 0.97;
    const m = mesh(ellipsoid(rx, tangential, rx * 0.3, 5), color, bodyGroup, along, y, z);
    m.rotation.x = side * (ring - Math.PI / 2);
  };

  if (detail > 0.6 && def.species === Species.Tiger) {
    /*
     * Stripes: vertical bands over the spine and down both flanks, built as a
     * run of overlapping marks around a ring so they follow the curve of the
     * barrel instead of cutting through it.
     *
     * Real tiger stripes are irregular, uneven in width and often forked, and
     * the cheapest convincing version of that is to vary the length and the
     * width of each band from a fixed hash rather than to draw them all alike.
     */
    const bands = 11;
    for (let b = 0; b < bands; b++) {
      const h = Math.sin(b * 78.233) * 43758.5453;
      const jitter = h - Math.floor(h);
      const along = ((b + 0.5) / bands - 0.5) * L * 0.86;
      // How far down the flank this one reaches. Short bands over the shoulder,
      // long ones over the ribs — which is where a tiger's are longest.
      const reach = 1.05 + Math.sin((b / bands) * Math.PI) * 0.75 + jitter * 0.3;
      /*
       * Narrower than they were, and forked.
       *
       * At nearly two per cent of the body length each the bands came out as a
       * row of thick black bars — a zebra's pattern, or a barcode, rather than a
       * tiger's. Real stripes are thin, uneven, and about a third of them split
       * into two partway down the flank; the fork is the detail that stops a
       * striped animal looking printed.
       */
      const width = L * (0.009 + jitter * 0.007);
      const forks = jitter > 0.62;
      for (const side of [-1, 1]) {
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const ring = t * reach;
          // Each patch has to reach at least to the next one, or the stripe
          // comes out as a dotted line down the flank.
          const span = (reach / steps) * barrelR * 0.8;
          // Lean the band backwards as it descends: they are not vertical.
          const lean = along - ring * L * 0.05;
          markOnBody(lean, ring, side, width * (1 - t * 0.35), span, c.accent);
          // The second limb of a forked stripe, peeling away below halfway.
          if (forks && t > 0.5) {
            markOnBody(lean - (t - 0.5) * L * 0.06, ring, side, width * 0.7, span, c.accent);
          }
        }
      }
    }
  } else if (style === 1 && detail > 0.6) {
    /*
     * Rosettes, for the leopard and the smaller spotted cats.
     *
     * The old version stepped one angle around a circle and used it for both the
     * position along the body and the position around it, so the spots traced a
     * single helix — from most angles a tidy diagonal stripe, which is a marking
     * no cat has. Rows down the flank, offset half a step from each other and
     * jittered by a fixed hash, scatter properly.
     */
    const rows = 4;
    const perRow = 6;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < perRow; i++) {
        const j = Math.sin((r * 13.7 + i * 7.3) * 12.9898) * 43758.5453;
        const jitter = j - Math.floor(j);
        const along = ((i + (r % 2) * 0.5 + jitter * 0.4) / perRow - 0.45) * L * 0.82;
        // Row 0 sits over the spine, the rest down each flank.
        const ring = -0.3 + r * 0.5 + jitter * 0.18;
        for (const side of [-1, 1]) {
          if (r === 0 && side < 0) continue; // the spine row exists once
          const rx = W * 0.07 + jitter * W * 0.03;
          markOnBody(along, ring, side, rx, rx * 0.85, c.accent);
          // The pale centre that makes a rosette a rosette rather than a spot.
          if (detail > 0.8) markOnBody(along, ring, side, rx * 0.42, rx * 0.36, c.body);
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
  /*
   * Deeper than it was. At W * 0.3 the torso was a quarter of a metre tall on a
   * body three quarters of a metre wide — a slab, and the reason the whole
   * animal read as something stamped out of sheet metal. A crocodilian is
   * flattened, not flat: roughly two thirds as deep as it is wide.
   */
  const torso = mesh(
    ellipsoid(L * 0.34, W * 0.33, W * 0.48, detail > 0.5 ? 10 : 6),
    c.body,
    bodyGroup,
  );
  torso.castShadow = true;

  if (detail > 0.4) {
    /*
     * The belly, as overlapping transverse scutes rather than one slab.
     *
     * A crocodile's underside is banded — that banding is most of what you see
     * when one turns in the water, and a single box read as a plank glued under
     * a tube.
     */
    const bands = 7;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const taper = 0.72 + Math.sin(t * Math.PI) * 0.28;
      const band = mesh(
        box(L * 0.075, H * 0.1, W * 0.66 * taper),
        i % 2 === 0 ? c.belly : c.accent,
        bodyGroup,
        (t - 0.5) * L * 0.58,
        -H * 0.3,
        0,
      );
      band.receiveShadow = true;
    }
  }

  /*
   * --- Armour ------------------------------------------------------------
   *
   * The osteoderms: the bony plates that make a crocodilian look armoured
   * rather than merely scaly, and the single feature that most separates one
   * from a lizard at a glance. Three ranks — a raised double row over the
   * spine and a flatter row down each flank — running the length of the body
   * and continuing onto the tail below.
   *
   * Built as flattened, tilted boxes rather than cones: a cone reads as a spike
   * and a crocodile's back is plated, not spiny.
   */
  if (detail > 0.5) {
    const plates = detail >= 1 ? 9 : 6;
    for (let i = 0; i < plates; i++) {
      const t = i / (plates - 1);
      const x = (t - 0.5) * L * 0.62;
      // Tallest over the shoulders and hips, lower at the waist.
      const rise = 0.7 + Math.sin(t * Math.PI * 2) * 0.3;
      for (const side of [-1, 1]) {
        const keel = mesh(
          box(L * 0.07, H * 0.13 * rise, W * 0.17),
          c.accent,
          bodyGroup,
          x,
          W * 0.26,
          side * W * 0.13,
        );
        keel.rotation.z = side * 0.12;
        keel.castShadow = true;
        // Flank rank, flatter and pressed against the side.
        const flank = mesh(
          box(L * 0.06, H * 0.12, W * 0.13),
          c.accent,
          bodyGroup,
          x,
          W * 0.05,
          side * W * 0.42,
        );
        flank.rotation.x = side * 0.6;
      }
    }
  }

  // Long jaw.
  const head = new THREE.Group();
  head.position.set(L * 0.42, 0, 0);
  bodyGroup.add(head);
  model.head = head;

  // Shoulders: blends the head into the torso instead of butting against it.
  mesh(ellipsoid(W * 0.3, W * 0.26, W * 0.44, detail > 0.5 ? 8 : 5), c.body, bodyGroup, L * 0.3, 0, 0);

  /*
   * The skull.
   *
   * Two stacked masses: a broad cranium at the hinge and a long snout that
   * narrows towards the nostrils. The old single box gave a head of constant
   * width from ear to nose, which is an alligator-shaped brick — the taper is
   * the shape.
   */
  /*
   * ## Scale the head off the body's *length*, not its height
   *
   * `H` for a caiman is its shoulder height — half a metre on a three-and-a-half
   * metre animal — so a skull built as a fraction of it came out eleven
   * centimetres deep and eight at the snout. From the side that is not a head,
   * it is a ruler: a flat plank sticking out of the front of the animal, which
   * was by a distance the worst thing about this model. A crocodilian skull is
   * about an eighth of the animal long and half as deep as it is wide, and both
   * of those are proportions of *length*.
   */
  const skullLen = L * 0.13;
  const skullDeep = L * 0.055;
  const upperJaw = mesh(
    box(skullLen, skullDeep, W * 0.54),
    c.body,
    head,
    L * 0.02,
    skullDeep * 0.35,
    0,
  );
  upperJaw.castShadow = true;
  // The snout: two tapering blocks rather than one, so the head has a profile
  // that narrows and shallows towards the nostrils instead of a constant slab.
  const snout = mesh(
    box(L * 0.15, skullDeep * 0.78, W * 0.38),
    c.body,
    head,
    L * 0.15,
    skullDeep * 0.2,
    0,
  );
  snout.castShadow = true;
  mesh(box(L * 0.1, skullDeep * 0.6, W * 0.27), c.body, head, L * 0.27, skullDeep * 0.12, 0);
  // Lower jaw, hinged — a crocodile's gape is its whole personality.
  addJaw(model, head, {
    hingeX: -L * 0.03,
    hingeY: -skullDeep * 0.42,
    length: L * 0.34,
    height: skullDeep * 0.62,
    width: W * 0.46,
    color: c.body,
  });
  if (detail > 0.4) {
    // Snout tip and the nostril bump on top of it.
    mesh(box(L * 0.05, skullDeep * 0.5, W * 0.2), c.body, head, L * 0.335, skullDeep * 0.1, 0);
    mesh(
      ellipsoid(L * 0.03, skullDeep * 0.28, W * 0.09, 6),
      c.accent,
      head,
      L * 0.34,
      skullDeep * 0.42,
      0,
    );
    /*
     * The famous eyes-above-the-water silhouette, on raised turrets.
     *
     * The turret matters as much as the eye: a crocodile's eyes sit on bony
     * mounds that stay above the surface when the rest of the skull is under
     * it, and an eye sunk flush into the head loses the whole read.
     */
    for (const side of [-1, 1]) {
      mesh(
        ellipsoid(W * 0.12, W * 0.1, W * 0.12, 6),
        c.body,
        head,
        L * 0.01,
        skullDeep * 0.85,
        side * W * 0.2,
      );
      mesh(sphere(W * 0.08, 7), c.eye, head, L * 0.02, skullDeep * 1.25, side * W * 0.21);
      if (detail > 0.6) {
        // A vertical slit pupil, which is what makes it read as a reptile eye
        // rather than as a bead.
        const pupil = mesh(
          box(W * 0.02, W * 0.09, W * 0.05),
          0x0b0a08,
          head,
          L * 0.055,
          skullDeep * 1.3,
          side * W * 0.215,
        );
        pupil.rotation.z = 0.1;
      }
      // Ear flap, just behind the eye.
      if (detail > 0.7) {
        mesh(
          box(L * 0.035, skullDeep * 0.4, W * 0.04),
          c.accent,
          head,
          -L * 0.045,
          skullDeep * 0.9,
          side * W * 0.22,
        );
      }
    }
    /*
     * Teeth, in two interlocking rows.
     *
     * Upper teeth point down from the maxilla and lower teeth point up from the
     * jaw, and they are offset along the snout so they mesh rather than meet —
     * which is exactly what makes a crocodile's closed mouth look dangerous
     * instead of like a seam. The lower row is parented to the hinged jaw, so
     * opening the mouth separates them.
     */
    if (detail > 0.7) {
      const upperCount = 8;
      for (let i = 0; i < upperCount; i++) {
        const t = i / (upperCount - 1);
        // Taper the row with the snout, and shrink the teeth towards the tip.
        const spread = W * (0.22 - t * 0.08);
        const size = 1 - t * 0.45;
        for (const side of [-1, 1]) {
          const tooth = mesh(
            cone(W * 0.032 * size, H * 0.17 * size),
            0xf2ece0,
            head,
            L * (0.02 + t * 0.32),
            -H * 0.06,
            side * spread,
          );
          tooth.rotation.x = Math.PI;
        }
      }
      if (model.jaw) {
        const lowerCount = 7;
        for (let i = 0; i < lowerCount; i++) {
          // Half a step offset from the upper row, so the two mesh.
          const t = (i + 0.5) / lowerCount;
          const spread = W * (0.2 - t * 0.07);
          const size = 1 - t * 0.4;
          for (const side of [-1, 1]) {
            mesh(
              cone(W * 0.03 * size, H * 0.15 * size),
              0xf2ece0,
              model.jaw,
              L * (0.04 + t * 0.3),
              H * 0.02,
              side * spread,
            );
          }
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

  /*
   * The tail — the crocodile's whole back half, and half its length.
   *
   * Taller than it is wide, and that is not decoration: a crocodilian tail is a
   * vertical paddle, which is why the animal sculls with it side to side and why
   * a round tail would look like a lizard's. It is anchored well inside the
   * torso, because the old anchor sat a fifth of a metre behind the body and
   * left the animal visibly in two pieces.
   */
  if (s.tail > 0.05) {
    addTail(model, bodyGroup, {
      x: -L * 0.28,
      y: 0,
      length: L * s.tail,
      segments: detail > 0.5 ? 6 : 3,
      rootY: W * 0.34,
      rootZ: W * 0.3,
      tipY: W * 0.07,
      tipZ: W * 0.035,
      color: c.body,
      detail,
      droop: 0.02,
      decorate: (segment, index, radius, segLen) => {
        if (detail <= 0.6) return;
        /*
         * The double caudal crest. It runs as two rows near the base and merges
         * into one down the last third, exactly as it does on the animal, and it
         * is the detail that makes a tail in the water read as a crocodile
         * rather than as a floating branch.
         */
        const single = index >= 3;
        for (const side of single ? [0] : [-1, 1]) {
          const keel = mesh(
            box(segLen * 0.45, radius * 0.46, radius * 0.26),
            c.accent,
            segment,
            -segLen * 0.5,
            radius * 0.78,
            side * radius * 0.34,
          );
          keel.rotation.z = 0.05;
          keel.castShadow = true;
        }
      },
    });
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

/**
 * The gorilla, and any other great ape.
 *
 * ## Why this is not the monkey builder
 *
 * `buildPrimate` makes a light, long-limbed, long-tailed animal that holds its
 * torso upright on a narrow chest — a howler monkey, which is what it was
 * written for. Feeding a gorilla through it produced a horizontal black sausage
 * on four identical sticks, and no amount of tuning the numbers fixes that,
 * because the thing that makes an ape an ape is a set of proportions the monkey
 * builder cannot express:
 *
 *  • The mass is at the top. A gorilla is a huge chest and shoulders tapering to
 *    small hips, which is the exact inverse of most quadrupeds and the reason a
 *    silverback reads as "powerful" from a hundred metres away.
 *  • The arms are longer than the legs, and it walks on its knuckles. That is
 *    what tilts the spine — shoulders high, hips low — and the tilt is the pose
 *    everyone recognises.
 *  • The skull has a crest on top and a brow over the front, and almost no
 *    forehead between them.
 *  • And there is a saddle of grey across the back, which is the single most
 *    identifiable marking on any animal in this game.
 */
function buildApe(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const L = s.length;
  const H = s.height;
  const W = s.width;

  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = H * 0.72;
  model.root.add(bodyGroup);
  model.body = bodyGroup;

  // --- Torso: heavy at the shoulder, tapering to the hips ----------------
  /*
   * Described as data first, for the same reason the quadruped's barrel is: the
   * silverback saddle has to be laid on the *actual* top of the back, and the
   * back is a union of three ellipsoids whose top surface drops by a quarter of
   * a metre from the shoulder to the hip. A single flat plate at a guessed
   * height ended up buried inside the chest, invisible — which cost the animal
   * its one unmistakable marking.
   */
  type Mass = { cx: number; cy: number; rx: number; ry: number; rz: number };
  const masses: Mass[] = [
    // Chest.
    { cx: L * 0.1, cy: H * 0.16, rx: L * 0.27, ry: W * 0.44, rz: W * 0.5 },
    // Gut, lower and further back.
    { cx: -L * 0.14, cy: -H * 0.06, rx: L * 0.25, ry: W * 0.38, rz: W * 0.42 },
  ];
  if (detail > 0.4) {
    // The shoulder yoke: the widest part of the animal, and the reason it can
    // pull a small tree over.
    masses.push({ cx: L * 0.16, cy: H * 0.28, rx: L * 0.14, ry: W * 0.26, rz: W * 0.62 });
  }
  for (const m of masses) {
    const piece = mesh(
      ellipsoid(m.rx, m.ry, m.rz, detail > 0.5 ? 10 : 6),
      c.body,
      bodyGroup,
      m.cx,
      m.cy,
      0,
    );
    piece.castShadow = true;
  }

  /** Height of the topmost surface of the back at this point along the body. */
  const backTop = (x: number): number => {
    let top = -Infinity;
    for (const m of masses) {
      const t = (x - m.cx) / m.rx;
      if (Math.abs(t) >= 1) continue;
      top = Math.max(top, m.cy + m.ry * Math.sqrt(1 - t * t));
    }
    return top;
  };

  if (detail >= 1) {
    /*
     * The coat, over the barrel. Lighter tufts than the body, not darker: fur is
     * legible because it catches light along its edges, and darkening it only
     * fills the silhouette back in.
     */
    addFur(bodyGroup, {
      rx: L * 0.25,
      ry: W * 0.4,
      rz: W * 0.46,
      count: 130,
      length: W * 0.1,
      colors: [c.body, c.belly, c.body, 0x2f2b2d],
      centre: [-L * 0.06, H * 0.02, 0],
    });
  }

  if (detail > 0.4) {
    /*
     * The silverback saddle, laid along the back in patches that each sit on the
     * surface where they are, and applied after the coat so it reads over it.
     */
    const patches = detail > 0.6 ? 7 : 4;
    for (let i = 0; i < patches; i++) {
      const x = L * (-0.24 + (i / (patches - 1)) * 0.5);
      const top = backTop(x);
      if (!Number.isFinite(top)) continue;
      // Wider over the shoulders, narrowing towards the hips, like the animal's.
      const width = W * (0.34 - (i / (patches - 1)) * 0.12);
      const patch = mesh(
        ellipsoid(L * 0.06, W * 0.08, width, detail > 0.6 ? 8 : 5),
        c.accent,
        bodyGroup,
        x,
        top - W * 0.03,
        0,
      );
      patch.castShadow = false;
    }
  }

  // --- Head --------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(L * 0.3, H * 0.34, 0);
  bodyGroup.add(head);
  model.head = head;

  // A neck you cannot really see on the animal, only a thickening.
  if (detail > 0.4) {
    mesh(ellipsoid(W * 0.16, W * 0.14, W * 0.22, 7), c.body, bodyGroup, L * 0.24, H * 0.3, 0);
  }

  const skull = mesh(
    ellipsoid(W * 0.21, W * 0.24, W * 0.23, detail > 0.5 ? 10 : 6),
    c.body,
    head,
  );
  skull.castShadow = true;

  if (detail > 0.4) {
    /*
     * The sagittal crest: the bony ridge along the top of the skull that anchors
     * the jaw muscles. On a big male it is the tallest thing on the animal, and
     * without it an ape's head is a ball.
     */
    /*
     * The sagittal crest: a *ridge* along the skull, not a spike on top of it.
     * At a tenth of the body width tall and a twentieth wide it stood up off the
     * head like an aerial; a crest is a low blade you read from the profile.
     */
    const crest = mesh(
      ellipsoid(W * 0.16, W * 0.055, W * 0.035, 6),
      c.body,
      head,
      -W * 0.02,
      W * 0.21,
      0,
    );
    crest.castShadow = true;
    // Brow ridge, a single heavy shelf rather than two lumps.
    mesh(box(W * 0.09, W * 0.07, W * 0.34), c.body, head, W * 0.16, W * 0.1, 0);
    // Prognathic muzzle: forward and *down*, which is what an ape's face does.
    mesh(ellipsoid(W * 0.15, W * 0.12, W * 0.19, detail > 0.5 ? 8 : 5), c.belly, head, W * 0.2, -W * 0.09, 0);
    mesh(ellipsoid(W * 0.04, W * 0.035, W * 0.08, 6), 0x141112, head, W * 0.34, -W * 0.04, 0);

    addJaw(model, head, {
      hingeX: W * 0.04,
      hingeY: -W * 0.18,
      length: W * 0.28,
      height: W * 0.08,
      width: W * 0.22,
      color: c.belly,
    });

    for (const side of [-1, 1]) {
      // Deep-set eyes under the brow.
      mesh(sphere(W * 0.032, 6), 0x2a1c10, head, W * 0.19, W * 0.03, side * W * 0.09);
      // Small ears, flat to the skull — nothing like a monkey's.
      mesh(ellipsoid(W * 0.02, W * 0.05, W * 0.03, 5), c.belly, head, -W * 0.06, W * 0.02, side * W * 0.21);
    }
  }

  // --- Limbs -------------------------------------------------------------
  /*
   * Arms first, then legs, because the gait animator pairs index 0 with index 3
   * and index 1 with index 2 — which for this order is a correct diagonal walk.
   *
   * The arms are long enough to reach the ground from a shoulder that is at the
   * animal's full height, so it stands on its knuckles; the legs are barely half
   * that, which is what tips the spine forward. Getting the ratio wrong in
   * either direction turns a gorilla into a bear or into a chimp.
   */
  if (detail > 0.25) {
    const armLen = H * 0.97;
    const legLen = H * 0.68;

    for (const side of [1, -1]) {
      addJointedLeg(model, bodyGroup, {
        x: L * 0.16,
        y: H * 0.24,
        z: side * W * 0.46,
        length: armLen,
        radius: W * 0.135,
        color: c.body,
        // Bare knuckles, paler than the coat: the part of a gorilla that
        // actually touches the ground.
        footColor: c.belly,
        forward: -1,
        detail,
        toes: 4,
      });
      // A deltoid over the shoulder joint, so the arm does not appear to be
      // pegged into the side of the chest.
      if (detail > 0.5) {
        const hip = model.legs[model.legs.length - 1];
        mesh(ellipsoid(W * 0.17, W * 0.2, W * 0.16, 8), c.body, hip, 0, -W * 0.06, 0);
      }
    }

    for (const side of [1, -1]) {
      addJointedLeg(model, bodyGroup, {
        x: -L * 0.24,
        y: -H * 0.06,
        z: side * W * 0.26,
        length: legLen,
        radius: W * 0.15,
        color: c.body,
        footColor: c.belly,
        forward: 1,
        detail,
        toes: 4,
      });
      if (detail > 0.5) {
        const hip = model.legs[model.legs.length - 1];
        mesh(ellipsoid(W * 0.17, W * 0.19, W * 0.17, 8), c.body, hip, 0, -W * 0.08, 0);
      }
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
    /*
     * Laid on the shell's own surface, and *flat*.
     *
     * The plates used to be rounded lumps at hand-picked heights, which from
     * above read as a row of pebbles glued to a dome — the exact opposite of the
     * effect wanted, since the point of a scute is that it is a flat plate with
     * an edge. Placing them by direction from the shell's centre puts them on
     * the surface wherever that surface happens to be, and flattening them along
     * the outward normal (a rotation about X, as with the body markings — see
     * the note there on why `lookAt` will not do) makes them plates rather than
     * blisters.
     */
    const shellR: [number, number, number] = [
      W * 0.62 * (L / (W * 1.24)),
      W * 0.62 * 0.62,
      W * 0.62,
    ];
    const shellY = H * 0.1;
    const plate = (along: number, ring: number, side: number, size: number, color: number): void => {
      // `along` is -1..1 down the shell, `ring` the angle from the spine.
      const t = Math.max(-0.999, Math.min(0.999, along));
      const shrink = Math.sqrt(1 - t * t);
      const m = mesh(
        ellipsoid(size * L * 0.5, size * W * 0.5, size * W * 0.14, 6),
        color,
        bodyGroup,
        t * shellR[0] * 0.97,
        shellY + Math.cos(ring) * shellR[1] * 0.97 * shrink,
        side * Math.sin(ring) * shellR[2] * 0.97 * shrink,
      );
      m.rotation.x = side * (ring - Math.PI / 2);
      m.castShadow = false;
    };

    // A central row of vertebrals, flanked by two rows of costals a side.
    for (let i = 0; i < 5; i++) {
      plate((i / 4 - 0.5) * 1.35, 0, 1, 0.3, c.body);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        plate((i / 3 - 0.5) * 1.3, 0.62, side, 0.28, c.belly);
        plate((i / 3 - 0.5) * 1.2, 1.18, side, 0.24, c.body);
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

    /*
     * Banded armour, for the armadillo.
     *
     * An armadillo is not a domed tortoise: its shell is a rigid front and rear
     * shield with a set of hinged bands between them, and those bands are the
     * whole silhouette — they are why it can roll up. Sharing the tortoise's
     * body plan meant it was drawn as a tortoise, which is a different animal.
     */
    if (def.species === Species.Armadillo) {
      const bands = 6;
      // Each band is an arc of small plates stepped over the shell's
      // cross-section, which is the only way to get a band that actually follows
      // the curve — a stretched box just makes a flat slab through the middle.
      const perBand = 9;
      for (let i = 0; i < bands; i++) {
        const t = (i + 0.5) / bands;
        const x = (t - 0.5) * L * 0.5;
        for (let j = 0; j < perBand; j++) {
          const a = (j / (perBand - 1) - 0.5) * Math.PI * 0.92;
          mesh(
            box(L * 0.045, H * 0.06, W * 0.14),
            j % 2 === 0 ? c.accent : c.body,
            bodyGroup,
            x,
            H * 0.1 + Math.cos(a) * H * 0.34,
            Math.sin(a) * W * 0.56,
          ).rotation.x = a;
        }
      }
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
    /*
     * The yellow scales.
     *
     * The species is called a *yellow-footed* tortoise and neither its head nor
     * its feet had a scrap of yellow on them — dark olive skin against a bright
     * shell, so the head read as a small dark blob stuck on the front. The
     * scales are the animal's name; they are also the only thing that separates
     * the head from the shadow it sits in.
     */
    for (const side of [-1, 1]) {
      mesh(ellipsoid(W * 0.06, W * 0.05, W * 0.04, 5), c.accent, head, W * 0.13, W * 0.09, side * W * 0.13);
      mesh(ellipsoid(W * 0.05, W * 0.04, W * 0.035, 5), c.accent, head, -W * 0.02, W * 0.04, side * W * 0.17);
      mesh(ellipsoid(W * 0.045, W * 0.035, W * 0.03, 5), c.accent, head, W * 0.16, -W * 0.05, side * W * 0.14);
    }
    for (const side of [-1, 1]) {
      // A pale ring round the eye, so a near-black eye on a dark head is
      // findable at all. Placed before the eye so the eye reads as set into it.
      mesh(ellipsoid(W * 0.07, W * 0.06, W * 0.04, 6), c.accent, head, W * 0.2, W * 0.08, side * W * 0.145);
      mesh(sphere(W * 0.05, 6), c.eye, head, W * 0.215, W * 0.085, side * W * 0.155);
      if (detail > 0.6) mesh(sphere(W * 0.024, 5), 0xd8cba0, head, W * 0.245, W * 0.095, side * W * 0.163);
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
      // Yellow scales down the leg, which is the half of the name the feet were
      // missing. On the hip, so they travel with the limb.
      if (detail > 0.6) {
        const hip = model.legs[model.legs.length - 1];
        for (let i = 0; i < 3; i++) {
          for (const around of [0.4, 2.2, 4.0]) {
            mesh(
              ellipsoid(W * 0.035, W * 0.028, W * 0.035, 5),
              c.accent,
              hip,
              Math.cos(around) * W * 0.1,
              -H * (0.08 + i * 0.11),
              Math.sin(around) * W * 0.1,
            );
          }
        }
      }
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

/**
 * The hunter: the only human being in the jungle.
 *
 * ## Why this one is built differently
 *
 * Every other model in this file is trying to look like an animal, and the way
 * you do that is with anatomy — a ribcage, a haunch, a skull. A person is not
 * read that way. At the distance this model is usually seen, a human being is
 * recognised almost entirely by *clothing*: the horizontal line of a cap brim,
 * the break at the belt, the way trousers stop and boots begin. A bare humanoid
 * of correctly proportioned capsules reads as a shop mannequin; the same
 * proportions with a collar, a belt and boot cuffs read as a man in the trees.
 *
 * So the shirt is modelled as a garment *over* the torso rather than as the
 * torso, and the trousers tuck into the boots instead of merely changing colour.
 * Those two seams cost four boxes and do most of the work.
 *
 * ## The face
 *
 * There isn't one, and that is deliberate. The design asks for a cap that covers
 * the face, and the honest reason it matters is that a hidden face is
 * frightening in a way a modelled one never is: the players cannot tell where
 * the hunter is looking, so they must assume he is looking at them. The brim is
 * wide, the head beneath it is dark cloth, and nothing under it catches light.
 */
function buildHuman(model: AnimalModel, def: AnimalDef, detail: number): void {
  const s = def.silhouette;
  const c = s.colors;
  const H = s.height;

  /** Shirt blue, trousers green, leather brown — the three the design names. */
  const shirt = c.body;
  const shirtDark = 0x24486f;
  const trousers = c.belly;
  const leather = c.accent;
  const leatherDark = 0x38281a;
  /** Gun metal, walnut, and the dark cloth under the cap. Nowhere else. */
  const gunmetal = 0x2b2c30;
  const walnut = 0x53331c;
  const shadowCloth = 0x1b1917;
  const skin = 0x8a6247;

  /*
   * The pelvis is the root of everything, because it is the part of a walking
   * human that moves least — the legs swing below it and the torso rides on top
   * of it, and hanging both off the same group means the gait animator's body
   * bob carries the whole figure without the legs sliding out of their sockets.
   */
  const legLength = H * 0.46;
  const legRadius = H * 0.043;
  const hipY = legLength + legRadius * 0.65;
  /*
   * Feet apart. At H * 0.072 the two legs were closer together than they were
   * thick, so from behind they merged into a single column and the man read as a
   * post — which at two metres tall is a lot of post.
   */
  const stance = H * 0.098;

  const pelvis = new THREE.Group();
  pelvis.position.y = hipY;
  model.root.add(pelvis);
  model.body = pelvis;

  mesh(box(H * 0.125, H * 0.115, H * 0.185), trousers, pelvis, 0, H * 0.005, 0);
  // The belt. One box, and it is the difference between "trousers" and "legs".
  mesh(box(H * 0.135, H * 0.03, H * 0.195), leather, pelvis, 0, H * 0.062, 0);
  if (detail > 0.5) {
    mesh(box(H * 0.018, H * 0.036, H * 0.028), 0xb8973f, pelvis, H * 0.069, H * 0.062, 0);
  }

  // --- Legs -------------------------------------------------------------
  /*
   * `forward: 1` is what makes these read as human legs rather than as an
   * animal's forelegs: it folds the knee backwards, which is the one joint
   * direction every viewer knows by heart without being able to name it.
   */
  const shank = legLength * 0.5;
  for (const side of [1, -1]) {
    addJointedLeg(model, pelvis, {
      x: 0,
      y: -H * 0.02,
      z: side * stance,
      length: legLength,
      radius: legRadius,
      color: trousers,
      footColor: leatherDark,
      forward: 1,
      detail,
    });
    const knee = model.knees[model.knees.length - 1];
    if (!knee || detail <= 0.4) continue;
    /*
     * The boot, built onto the shank of the leg just added.
     *
     * Three pieces rather than one block: a shaft the trousers disappear into,
     * a flared cuff at the top of it, and a sole that projects forward past the
     * shin. That last one is what stops a leg ending in a cube — a foot points
     * somewhere, and which way it points is how you read which way a figure is
     * facing when it is too far away to see anything else.
     */
    mesh(box(legRadius * 2.0, shank * 0.6, legRadius * 2.1), leather, knee, 0, -shank * 0.66, 0);
    mesh(box(legRadius * 2.4, legRadius * 0.8, legRadius * 2.5), leather, knee, 0, -shank * 0.36, 0);
    mesh(
      box(legRadius * 3.4, legRadius * 0.85, legRadius * 2.0),
      leatherDark,
      knee,
      legRadius * 0.7,
      -shank - legRadius * 0.35,
      0,
    );
    // Toe cap, lower and shorter than the sole, so the boot has a front.
    mesh(
      box(legRadius * 1.1, legRadius * 0.6, legRadius * 1.8),
      leatherDark,
      knee,
      legRadius * 2.0,
      -shank - legRadius * 0.55,
      0,
    );
  }

  // --- Torso ------------------------------------------------------------
  /*
   * A V, not a barrel. The first version of this was two ellipsoids of nearly
   * the same width stacked on top of each other, and it read as a pear — which
   * is what happens when a torso is as broad at the belt as it is at the
   * shoulders. Shoulders wide and shallow, waist noticeably narrower, and the
   * whole thing much flatter front-to-back than it is side-to-side.
   */
  const torso = new THREE.Group();
  torso.position.y = H * 0.075;
  pelvis.add(torso);

  const chest = mesh(
    ellipsoid(H * 0.062, H * 0.115, H * 0.1, detail > 0.5 ? 9 : 6),
    shirt,
    torso,
    0,
    H * 0.175,
    0,
  );
  chest.castShadow = true;
  mesh(ellipsoid(H * 0.052, H * 0.07, H * 0.078, detail > 0.5 ? 8 : 5), shirt, torso, 0, H * 0.05, 0);

  const shoulderY = H * 0.26;
  if (detail > 0.35) {
    // Shoulder yoke — the horizontal line across the top of a shirt, and the
    // widest thing on him, which is what makes the taper downwards read.
    mesh(box(H * 0.1, H * 0.032, H * 0.245), shirt, torso, 0, shoulderY, 0);
    mesh(box(H * 0.075, H * 0.026, H * 0.115), shirtDark, torso, 0, shoulderY + H * 0.024, 0);
    // Buttoned placket down the front.
    mesh(box(H * 0.01, H * 0.17, H * 0.02), shirtDark, torso, H * 0.062, H * 0.14, 0);
  }

  // --- Head, and the cap that hides it ----------------------------------
  const head = new THREE.Group();
  head.position.set(0, shoulderY + H * 0.1, 0);
  torso.add(head);
  model.head = head;

  // Neck: dark, because a lit neck under a dark face gives the face away.
  mesh(capsule(H * 0.026, H * 0.045, 6), shadowCloth, torso, 0, shoulderY + H * 0.04, 0);

  const skull = mesh(
    ellipsoid(H * 0.056, H * 0.062, H * 0.052, detail > 0.5 ? 10 : 6),
    shadowCloth,
    head,
  );
  skull.castShadow = true;

  // The cap: a crown that sits on the skull and a brim that oversails the face.
  mesh(ellipsoid(H * 0.062, H * 0.05, H * 0.058, detail > 0.5 ? 10 : 6), leather, head, -H * 0.004, H * 0.032, 0);
  const brim = mesh(box(H * 0.082, H * 0.012, H * 0.115), leather, head, H * 0.075, H * 0.024, 0);
  brim.rotation.z = -0.17;
  if (detail > 0.5) {
    /*
     * Eyes exist, but only barely — two chips of dull light deep under the brim.
     * Leaving them out entirely made the head read as a bag; two dark specks
     * with almost no value contrast read as a face you cannot quite see, which
     * is much worse to be looked at by.
     */
    mesh(sphere(H * 0.007, 5), 0x6a6256, head, H * 0.046, H * 0.002, H * 0.022);
    mesh(sphere(H * 0.007, 5), 0x6a6256, head, H * 0.046, H * 0.002, -H * 0.022);
  }

  // --- Arms, posed on the rifle -----------------------------------------
  /*
   * These do not swing. A hunter carrying a rifle at the ready holds it with
   * both hands, and arms that swung freely while a gun floated in front of the
   * chest would look far worse than arms that are simply still.
   *
   * Facing is +X and up is +Y, so the figure's right-hand side is -Z. Rotating a
   * downward-hanging limb about X by a positive angle swings it towards -Z, so
   * the right arm's roll is positive to move it *out* and the left arm's is
   * positive to bring it *across* — the same sign meaning opposite things on the
   * two sides, which is exactly the mistake that buried the right arm inside the
   * ribcage on the first attempt.
   */
  const upperArm = H * 0.175;
  const foreArm = H * 0.165;
  const armRadius = H * 0.031;

  /**
   * Build one arm so that its hand lands exactly on `target`.
   *
   * ## Why this is solved rather than eyeballed
   *
   * The first version set the two joint angles by hand and then placed the rifle
   * where the hands looked like they were. They were not: the barrel came out
   * pointing across the hunter's chest and slightly behind him, because a
   * shoulder rotation about two axes followed by an elbow bend does not put the
   * hand anywhere a person can predict by reading the numbers. Tuning that by
   * trial is a losing game — every adjustment to one angle moves the hand in a
   * direction that depends on the other.
   *
   * So the pose is stated the way it is actually meant: *the right hand is on
   * the grip and the left hand is out on the fore-end*, as two positions. The
   * two-link solve below is exact (law of cosines — there is no iteration and no
   * approximation), which means the rifle can then simply be fitted between the
   * two hands and is guaranteed to line up.
   *
   * Of the two mirror solutions the elbow-backwards one is chosen, because the
   * other one is an arm bending the wrong way at the elbow.
   */
  const reachArm = (side: 1 | -1, target: THREE.Vector3): THREE.Object3D => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, shoulderY - H * 0.015, side * H * 0.108);
    torso.add(shoulder);

    const L1 = upperArm;
    const L2 = foreArm;
    const toTarget = target.clone().sub(shoulder.position);
    // Clamp into the reachable annulus, so an over-ambitious target straightens
    // the arm instead of producing a NaN.
    const D = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, toTarget.length()));
    const dir = toTarget.normalize();

    // Frame: the limb hangs along local -Y, and it bends in the local XY plane,
    // so local +X has to be the direction the elbow is allowed to travel.
    const yA = dir.clone().negate();
    let xA = new THREE.Vector3().crossVectors(yA, new THREE.Vector3(0, 0, 1));
    if (xA.lengthSq() < 1e-6) xA = new THREE.Vector3(1, 0, 0);
    xA.normalize();
    const zA = new THREE.Vector3().crossVectors(xA, yA);
    shoulder.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(xA, yA, zA),
    );

    // Law of cosines. `alpha` is negative so the elbow swings backwards.
    const alpha = -Math.acos(
      Math.min(1, Math.max(-1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))),
    );
    const gamma = Math.acos(
      Math.min(1, Math.max(-1, (L2 * L2 + D * D - L1 * L1) / (2 * L2 * D))),
    );
    shoulder.rotateZ(alpha);

    mesh(sphere(armRadius * 1.25, detail > 0.5 ? 7 : 5), shirt, shoulder);
    mesh(capsule(armRadius, upperArm * 0.66, detail > 0.5 ? 7 : 5), shirt, shoulder, 0, -upperArm * 0.5, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -upperArm;
    elbow.rotation.z = gamma - alpha;
    shoulder.add(elbow);
    // Bare forearm below the rolled sleeve.
    mesh(capsule(armRadius * 0.8, foreArm * 0.68, detail > 0.5 ? 7 : 5), skin, elbow, 0, -foreArm * 0.5, 0);

    const hand = new THREE.Group();
    hand.position.y = -foreArm;
    elbow.add(hand);
    // Glove.
    mesh(box(armRadius * 1.8, armRadius * 2.0, armRadius * 1.6), leatherDark, hand);
    return hand;
  };

  /*
   * The pose, stated as the two things a rifle carry actually consists of: the
   * trigger hand back at the chest and the support hand out along the fore-end.
   */
  const gripTarget = new THREE.Vector3(H * 0.085, shoulderY - H * 0.185, -H * 0.085);
  const foreTarget = new THREE.Vector3(H * 0.275, shoulderY - H * 0.145, 0);
  const rightHand = reachArm(-1, gripTarget);
  const leftHand = reachArm(1, foreTarget);

  // --- The shotgun --------------------------------------------------------
  /*
   * A shotgun, not a scoped rifle.
   *
   * The design asks for a simple little man with a gun in his hands, and a
   * bolt-action with a telescopic sight is not that — it is a piece of
   * equipment, and reading it takes a second look. Two short barrels and a
   * wooden stock read as "gun" instantly and from a long way off, which is what
   * this silhouette is for. It also matches what he sees in his own hands: see
   * buildShotgunViewmodel.
   *
   * Fitted between the hands rather than posed beside them — the arms are solved
   * to two stated grip positions and the gun is aligned to the result, so
   * changing an arm drags the weapon with it.
   */
  model.root.updateMatrixWorld(true);
  const grip = rightHand.getWorldPosition(new THREE.Vector3());
  const fore = leftHand.getWorldPosition(new THREE.Vector3());

  const gun = new THREE.Group();
  gun.position.copy(torso.worldToLocal(grip.clone()));
  /*
   * The direction needs no basis change: every group between the root and the
   * torso is a pure translation at build time, so a direction in model space is
   * already a direction in torso space. (The positions do need converting, which
   * is what `worldToLocal` above is for.)
   */
  const along = fore.clone().sub(grip).normalize();
  gun.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), along);
  torso.add(gun);

  // Butt and wrist, behind the grip.
  const stock = mesh(box(H * 0.15, H * 0.045, H * 0.03), walnut, gun, -H * 0.105, -H * 0.012, 0);
  stock.castShadow = true;
  mesh(box(H * 0.05, H * 0.058, H * 0.028), walnut, gun, -H * 0.185, -H * 0.03, 0);
  // Receiver and the fore-end the left hand holds.
  mesh(box(H * 0.075, H * 0.042, H * 0.03), gunmetal, gun, H * 0.005, 0, 0);
  mesh(box(H * 0.1, H * 0.032, H * 0.028), walnut, gun, H * 0.095, -H * 0.006, 0);
  // Twin barrels side by side — the detail that says shotgun rather than rifle.
  for (const side of [-1, 1]) {
    const barrel = new THREE.Mesh(capsule(H * 0.009, H * 0.15, detail > 0.5 ? 7 : 5), material(gunmetal));
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(H * 0.2, H * 0.008, side * H * 0.01);
    barrel.castShadow = true;
    gun.add(barrel);
  }
  if (detail > 0.4) {
    mesh(box(H * 0.026, H * 0.016, H * 0.019), gunmetal, gun, -H * 0.026, -H * 0.026, 0);
  }

  /*
   * Muzzle flash: a star of unlit geometry at the barrel's mouth, switched on
   * for a few frames when the gun fires.
   *
   * MeshBasicMaterial rather than the Lambert everything else uses, because a
   * muzzle flash is a light source and a lit one would go dark at night —
   * precisely when it is the only thing anybody can see. Built here rather than
   * in the effects renderer so it is welded to the barrel and cannot drift out
   * of alignment when the hunter turns.
   */
  const flash = new THREE.Group();
  flash.position.set(H * 0.29, H * 0.008, 0);
  flash.visible = false;
  gun.add(flash);
  const flare = new THREE.Mesh(
    cone(H * 0.03, H * 0.07),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  flare.rotation.z = -Math.PI / 2;
  flare.position.x = H * 0.028;
  flash.add(flare);
  const halo = new THREE.Mesh(
    sphere(H * 0.024, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc65a, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  flash.add(halo);
  model.materials.push(flare.material as THREE.Material, halo.material as THREE.Material);
  model.muzzle = flash;
}

/**
 * The shotgun the hunter sees in his own hands.
 *
 * Built here rather than in the renderer because it shares the primitive and
 * material caches with everything else, and because it has to match the gun on
 * the model other players see — a viewmodel that disagreed with the world model
 * would be the game lying about what the man in the clearing is carrying.
 *
 * Modelled pointing along -Z, which is the direction a three.js camera looks, so
 * parenting it to the camera needs no rotation.
 */
export function buildShotgunViewmodel(): THREE.Group {
  const group = new THREE.Group();
  const walnut = 0x53331c;
  const gunmetal = 0x2b2c30;

  // Twin barrels, side by side. Short — this is a shotgun, and the stubbiness
  // is most of what tells it apart from a rifle at a glance.
  for (const side of [-1, 1]) {
    const barrel = new THREE.Mesh(capsule(0.021, 0.42, 8), material(gunmetal));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 0.023, 0.012, -0.26);
    group.add(barrel);
  }
  // Rib between them, and the bead at the muzzle you actually aim with.
  mesh(box(0.05, 0.012, 0.42), gunmetal, group, 0, 0.03, -0.26);
  mesh(sphere(0.008, 5), 0xb8a76a, group, 0, 0.04, -0.47);

  // Receiver, then the wrist and butt sweeping back and down to the shoulder.
  mesh(box(0.062, 0.06, 0.14), gunmetal, group, 0, 0, 0.02);
  mesh(box(0.05, 0.05, 0.13), walnut, group, 0, -0.014, 0.14);
  const butt = mesh(box(0.055, 0.075, 0.14), walnut, group, 0, -0.032, 0.26);
  butt.rotation.x = -0.12;
  // Fore-end under the barrels, where the left hand is.
  mesh(box(0.055, 0.042, 0.16), walnut, group, 0, -0.014, -0.16);
  // Trigger guard.
  mesh(box(0.03, 0.022, 0.05), gunmetal, group, 0, -0.042, 0.05);

  // The hands. Two blocks, but they are what make it *held* rather than floating.
  mesh(box(0.05, 0.05, 0.07), 0x38281a, group, 0, -0.048, 0.06);
  mesh(box(0.05, 0.05, 0.07), 0x38281a, group, 0, -0.05, -0.16);

  return group;
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
