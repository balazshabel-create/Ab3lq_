/**
 * Weapon.ts — the hunter's shotgun, built the way a game asset is built.
 *
 * ## What "made like the guns in Rainbow Six" actually means
 *
 * A modern shooter's weapon is not a detailed mesh. It is a *high*-poly sculpt
 * (Blender/ZBrush) whose surface detail — screw slots, chequering, milling
 * marks, wear along the edges — is **baked into texture maps**, and then a
 * low-poly cage wearing those maps is lit by a **physically based** shading
 * model: base colour, metalness, roughness, normal, plus a captured environment
 * for the metal to reflect. That last part is what sells it. Steel does not look
 * like steel because of its shape; it looks like steel because it is smooth,
 * conductive, and reflecting a room.
 *
 * This project ships as one HTML file with no asset pipeline and no image files,
 * so the sculpting and the baking cannot happen. Everything else can, and this
 * module does it:
 *
 *  • **PBR materials.** Blued steel, parkerised receiver, walnut, vulcanite,
 *    brass — each with real metalness and roughness values rather than a flat
 *    colour. `MeshStandardMaterial`, where the rest of the game is Lambert.
 *  • **Maps, generated instead of painted.** Wood grain, brushed-metal
 *    roughness variation and the chequering pattern are drawn into canvases at
 *    load time and used as colour, roughness and bump maps. Same maps a texture
 *    artist would author, produced by code because there is nowhere to put a
 *    .png.
 *  • **An environment to reflect.** A sky-to-ground gradient is prefiltered
 *    through `PMREMGenerator` and assigned to the gun's materials *only* — not
 *    to `scene.environment`, which would put reflections on every animal and
 *    leaf in the jungle.
 *  • **Detail where it is looked at.** The viewmodel sits in front of one
 *    player's eyes for a whole round, so it carries every screw. The world model
 *    is the same builder at `fine: false`, which drops the parts that are
 *    sub-pixel at ten metres.
 *
 * The gun is modelled pointing along **−Z**, the direction a three.js camera
 * looks, so the viewmodel can be parented to the camera with no rotation. The
 * origin is at the **trigger hand's grip**, which is what lets the world model
 * be positioned from the hunter's solved arm pose and rotated to lie along it.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural maps
// ---------------------------------------------------------------------------

/**
 * A canvas to draw a map into, or null where there is no DOM.
 *
 * The model builders are also run headless — by the triangle-count tool and by
 * anything else that wants to inspect a model without a browser — and a bare
 * `document.createElement` here would take those down with a ReferenceError. The
 * maps are cosmetic, so their absence costs a little richness and nothing else.
 */
function surface(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Walnut. A base tone with grain lines running along the stock.
 *
 * The grain is what makes wood read as wood rather than as brown plastic, and
 * it has to run *along* the piece: a stock is cut from a plank, so the lines
 * follow its length and bunch up into figure near the wrist. Drawn as bent
 * lines with a low-frequency wobble, which is the cheapest thing that does not
 * look like a barcode.
 */
function woodMap(): THREE.CanvasTexture | null {
  const canvas = surface(512, 128);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a2c17';
  ctx.fillRect(0, 0, 512, 128);

  // A few broad tonal bands first, so the piece is not uniformly dark.
  for (let i = 0; i < 14; i++) {
    const y = Math.random() * 128;
    ctx.fillStyle = `rgba(${110 + Math.random() * 40}, ${64 + Math.random() * 26}, ${30 + Math.random() * 18}, 0.22)`;
    ctx.fillRect(0, y, 512, 6 + Math.random() * 16);
  }
  // Then the grain itself.
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 128;
    const amp = 2 + Math.random() * 7;
    const period = 90 + Math.random() * 260;
    ctx.strokeStyle = `rgba(${20 + Math.random() * 26}, ${10 + Math.random() * 12}, 6, ${0.16 + Math.random() * 0.3})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.7;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const yy = y + Math.sin((x / period) * Math.PI * 2 + i) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Brushed steel roughness.
 *
 * Uniform roughness is the giveaway of an untextured metal: a real barrel has
 * polishing marks along it and its reflection breaks up because of them. This is
 * a greyscale map used as `roughnessMap`, so the highlight stretches and
 * flickers along the tube instead of sitting there as one clean band.
 */
function steelRoughnessMap(): THREE.CanvasTexture | null {
  const canvas = surface(256, 64);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * 64;
    const w = 12 + Math.random() * 120;
    const v = 96 + Math.random() * 96;
    ctx.strokeStyle = `rgba(${v},${v},${v},0.3)`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    ctx.moveTo(Math.random() * 256, y);
    ctx.lineTo(Math.random() * 256 + w, y + (Math.random() - 0.5) * 1.5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Chequering: the diamond pattern cut into a grip so a wet hand can hold it.
 *
 * On the previous gun this was five dark stripes glued to the fore-end, because
 * geometry cannot afford one raised diamond per square millimetre. As a bump
 * map it is what it is on a real gun — surface relief — and it costs one 128px
 * canvas for both panels.
 */
function chequeringMap(): THREE.CanvasTexture | null {
  const canvas = surface(128, 128);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);
  // Two crossing sets of lines at ±20° from the vertical: the standard cut.
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate(dir * 0.36);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.6;
    for (let i = -22; i <= 22; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 6, -110);
      ctx.lineTo(i * 6, 110);
      ctx.stroke();
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

let environment: THREE.Texture | null = null;

/**
 * Build the reflection the metal lives in: sky above, canopy and earth below.
 *
 * Prefiltered with `PMREMGenerator`, which is what turns one gradient into the
 * blurred-by-roughness reflections a PBR material needs — a rough receiver gets
 * a soft wash and a polished barrel gets a sharp horizon, from the same source.
 *
 * Deliberately **not** assigned to `scene.environment`: three applies that to
 * every material that supports an environment map, so it would silently put
 * reflections on all the foliage and every animal. The gun's materials take it
 * directly instead.
 */
export function initWeaponEnvironment(renderer: THREE.WebGLRenderer): void {
  if (environment) return;

  /*
   * The source is a *scene*, not a hand-packed texture.
   *
   * The first version built an equirectangular `DataTexture` — a vertical
   * gradient in bytes — and prefiltered that. It produced a technically valid
   * environment which rendered the steel almost black: eight-bit data with an
   * sRGB colour space is not what `fromEquirectangular` expects, so the
   * radiance it derived was a fraction of the intended brightness, and metal has
   * no diffuse term to fall back on.
   *
   * `fromScene` goes through the normal render path instead, so colour
   * management is the renderer's problem and the result is the brightness the
   * colours say. The scene is two objects: a sky dome seen from inside, and a
   * ground plane under it.
   */
  const source = new THREE.Scene();

  // Sky dome, vertex-coloured from zenith blue down to a pale horizon.
  const dome = new THREE.SphereGeometry(10, 12, 8);
  const position = dome.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const zenith = new THREE.Color(0x7ea9dd);
  const horizon = new THREE.Color(0xe8e6d6);
  const mixed = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(0, Math.min(1, position.getY(i) / 10));
    mixed.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
    colours[i * 3] = mixed.r;
    colours[i * 3 + 1] = mixed.g;
    colours[i * 3 + 2] = mixed.b;
  }
  dome.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  source.add(
    new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })),
  );

  // The ground: jungle floor, dim and green. A barrel pointed downwards has to
  // reflect *something*, and if that something is black the gun looks unlit.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshBasicMaterial({ color: 0x3d4a2c }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.5;
  source.add(floor);

  const pmrem = new THREE.PMREMGenerator(renderer);
  environment = pmrem.fromScene(source, 0.02).texture;
  pmrem.dispose();
  dome.dispose();
  floor.geometry.dispose();
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

interface WeaponMaterials {
  bluedSteel: THREE.MeshStandardMaterial;
  receiver: THREE.MeshStandardMaterial;
  brightSteel: THREE.MeshStandardMaterial;
  walnut: THREE.MeshStandardMaterial;
  walnutChequered: THREE.MeshStandardMaterial;
  ebony: THREE.MeshStandardMaterial;
  vulcanite: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  bore: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
}

let materials: WeaponMaterials | null = null;

/**
 * The material set, built once.
 *
 * The numbers are the point of this function. Metalness is not a dial for "how
 * shiny": it is whether a surface is a conductor, so it is 1 for every steel
 * part and 0 for wood, rubber and skin, with nothing in between. Roughness is
 * the dial — a polished barrel at 0.22, a parkerised receiver at 0.55, oiled
 * walnut at 0.5, a rubber butt pad at 0.92 — and it is what makes two parts of
 * the same colour read as different substances.
 */
function weaponMaterials(): WeaponMaterials {
  if (materials) return materials;

  const grain = woodMap();
  const brushed = steelRoughnessMap();
  const chequer = chequeringMap();

  /*
   * Maps are assigned after construction rather than passed in.
   *
   * Three warns — loudly, once per material — if a parameter is present with the
   * value `undefined`, which is exactly what a `?? undefined` in the constructor
   * produces when a map could not be drawn. Setting the property only when there
   * is something to set keeps the headless path silent.
   */
  const steel = (color: number, roughness: number): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color,
      metalness: 1,
      roughness,
      // Reflections are the whole reason the metal reads as metal, so they are
      // not dimmed even though the source is one small gradient.
      envMapIntensity: 1.15,
    });
    if (brushed) m.roughnessMap = brushed;
    if (environment) m.envMap = environment;
    return m;
  };

  const wood = (chequered: boolean): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x8f6440,
      metalness: 0,
      roughness: 0.52,
      envMapIntensity: 0.35,
    });
    if (grain) m.map = grain;
    if (environment) m.envMap = environment;
    if (chequered && chequer) {
      m.bumpMap = chequer;
      m.bumpScale = 0.9;
      // The panel is cut into the wood, so it also scatters more light.
      m.roughness = 0.68;
    }
    return m;
  };

  materials = {
    // Blued steel: dark, smooth, and the part that actually shines.
    bluedSteel: steel(0x24262b, 0.22),
    // The receiver is parkerised — a matte grey phosphate finish that scatters.
    receiver: steel(0x3a3d44, 0.55),
    // Bright steel for the small worked parts: lever, pins, triggers.
    // Not chrome: a worked steel part is bright *against blued steel*, and at
    // 0.3 roughness the top strap mirrored the sky like a car bumper.
    brightSteel: steel(0x6a6d75, 0.42),
    walnut: wood(false),
    walnutChequered: wood(true),
    ebony: new THREE.MeshStandardMaterial({ color: 0x120f0d, metalness: 0, roughness: 0.4 }),
    // Vulcanite butt pad: soft, dead matte, absorbs light.
    vulcanite: new THREE.MeshStandardMaterial({ color: 0x15130f, metalness: 0, roughness: 0.92 }),
    brass: steel(0xc9a227, 0.24),
    // The inside of a barrel is a hole. It gets no reflection at all.
    bore: new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0, roughness: 1 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x8a6247, metalness: 0, roughness: 0.72 }),
  };
  return materials;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A box with rounded-off edges, which is what every milled part actually has. */
function part(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** A tube along Z: barrels, pins, tenons. `r2` tapers it. */
function tube(
  parent: THREE.Object3D,
  material: THREE.Material,
  r: number,
  length: number,
  x: number,
  y: number,
  z: number,
  r2 = r,
  radial = 18,
): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r2, r, length, radial, 1, false);
  const m = new THREE.Mesh(g, material);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// The gun
// ---------------------------------------------------------------------------

export interface ShotgunParts {
  group: THREE.Group;
  /** Where a muzzle flash belongs, in the gun's own space. */
  muzzle: THREE.Vector3;
}

/**
 * A side-by-side hunting shotgun, along −Z, origin at the grip.
 *
 * `unit` is the overall length in world units — everything else is a fraction of
 * it, so the same builder makes a 1.05 m gun for the world and a slightly
 * smaller one for the viewmodel without a second set of numbers.
 *
 * `fine` adds the parts that only exist at arm's length: screw slots, rib
 * serrations, the extractor, the safety catch, sling swivels. At ten metres they
 * are sub-pixel and cost draw calls for nothing.
 */
export function buildShotgun(unit: number, fine: boolean): ShotgunParts {
  const m = weaponMaterials();
  const group = new THREE.Group();
  const u = unit;

  // --- Barrels ------------------------------------------------------------
  /*
   * Two tubes, tapered.
   *
   * A shotgun barrel is thick at the breech, where the pressure is, and thin at
   * the muzzle; a constant-radius rod is the single most model-like thing you
   * can put on a gun. The taper is only three millimetres over sixty
   * centimetres and it changes the whole read of the object.
   */
  const barrelLen = u * 0.5;
  const barrelZ = -u * 0.3;
  const spacing = u * 0.026;
  for (const side of [-1, 1]) {
    tube(group, m.bluedSteel, u * 0.024, barrelLen, side * spacing, u * 0.012, barrelZ, u * 0.019);

    // The crown: a ring at the mouth, and the bore behind it. Two black holes
    // at the end of a shotgun are the reason one is frightening, and a barrel
    // that ends in a solid cap is a pipe.
    const crownZ = barrelZ - barrelLen / 2;
    const crown = new THREE.Mesh(
      new THREE.TorusGeometry(u * 0.0165, u * 0.0035, 8, 20),
      m.brightSteel,
    );
    crown.position.set(side * spacing, u * 0.012, crownZ + u * 0.002);
    group.add(crown);
    tube(group, m.bore, u * 0.0155, u * 0.05, side * spacing, u * 0.012, crownZ + u * 0.026);
  }

  // The rib along the top, with the bead sight on a post at the end of it.
  /*
   * Narrow. At twice the barrel spacing the rib was a roof over both tubes, so
   * from above — which is the only angle its owner ever sees it from — the gun
   * had one flat top and the two barrels underneath it were invisible. A rib
   * runs *between* barrels and the tubes show either side of it.
   */
  const rib = part(group, m.receiver, spacing * 1.25, u * 0.012, barrelLen, 0, u * 0.028, barrelZ);
  rib.castShadow = false;
  if (fine) {
    // File-cut serrations across the rib, which are there to kill glare — and
    // which catch the light in a way that reads instantly as a gun.
    for (let i = 0; i < 26; i++) {
      part(
        group,
        m.bluedSteel,
        spacing * 1.15,
        u * 0.003,
        u * 0.004,
        0,
        u * 0.033,
        barrelZ - barrelLen / 2 + u * 0.03 + i * u * 0.017,
      ).castShadow = false;
    }
  }
  const beadZ = barrelZ - barrelLen / 2 + u * 0.02;
  part(group, m.brightSteel, u * 0.006, u * 0.012, u * 0.008, 0, u * 0.037, beadZ);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(u * 0.007, 12, 8), m.brass);
  bead.position.set(0, u * 0.045, beadZ);
  group.add(bead);

  // Barrel band with a sling swivel hanging off it.
  part(group, m.receiver, spacing * 2.6, u * 0.05, u * 0.014, 0, u * 0.01, barrelZ + barrelLen * 0.1);
  if (fine) {
    const swivel = new THREE.Mesh(
      new THREE.TorusGeometry(u * 0.011, u * 0.0026, 7, 16),
      m.brightSteel,
    );
    swivel.rotation.y = Math.PI / 2;
    swivel.position.set(0, -u * 0.026, barrelZ + barrelLen * 0.1);
    group.add(swivel);
  }

  // --- Receiver -----------------------------------------------------------
  /*
   * The action. Boxy on purpose — this is the part of a shotgun that *is* a
   * block of milled steel — but with the details that stop it being a block:
   * a top strap, a break lever, a snap-action fence at the front where the
   * barrels seat, hinge pins through the sides, and engraved side plates.
   */
  part(group, m.receiver, u * 0.072, u * 0.07, u * 0.17, 0, 0, u * 0.02);
  part(group, m.brightSteel, u * 0.076, u * 0.012, u * 0.17, 0, u * 0.037, u * 0.02);
  // The fences: the two rounded humps where the barrels meet the action, and
  // the most recognisable shape on a break-open gun.
  for (const side of [-1, 1]) {
    const fence = new THREE.Mesh(new THREE.SphereGeometry(u * 0.026, 16, 12), m.receiver);
    fence.scale.set(1, 0.85, 0.7);
    fence.position.set(side * spacing, u * 0.006, -u * 0.062);
    group.add(fence);
  }
  // Top lever, the thumb-piece you push to break the gun open.
  const lever = part(group, m.brightSteel, u * 0.018, u * 0.009, u * 0.055, 0, u * 0.044, u * 0.075);
  lever.rotation.z = 0.06;
  if (fine) {
    // Hinge pins and the two screw heads that hold the side plates on. A screw
    // slot is four pixels of geometry and it is the detail that says
    // "assembled" rather than "moulded".
    for (const side of [-1, 1]) {
      const pin = tube(group, m.brightSteel, u * 0.008, u * 0.004, side * u * 0.037, -u * 0.014, -u * 0.05);
      pin.rotation.z = Math.PI / 2;
      pin.rotation.x = 0;
      pin.rotation.y = Math.PI / 2;
      for (const z of [u * 0.0, u * 0.06]) {
        const screw = tube(group, m.brightSteel, u * 0.005, u * 0.003, side * u * 0.037, -u * 0.01, z);
        screw.rotation.y = Math.PI / 2;
        part(group, m.bluedSteel, u * 0.001, u * 0.007, u * 0.0016, side * u * 0.0385, -u * 0.01, z);
      }
      // An engraved side plate: a shallow inset panel, slightly brighter.
      part(group, m.brightSteel, u * 0.001, u * 0.04, u * 0.12, side * u * 0.0365, -u * 0.004, u * 0.025);
    }
    // Safety catch on the tang, behind the lever.
    part(group, m.bluedSteel, u * 0.012, u * 0.006, u * 0.026, 0, u * 0.043, u * 0.108);
  }

  // --- Trigger group ------------------------------------------------------
  /*
   * A guard bow with daylight through it, and *two* triggers — a side-by-side
   * fires one barrel each. Both are things you would never notice if they were
   * right and cannot stop noticing when they are wrong.
   */
  const guard = new THREE.Mesh(
    new THREE.TorusGeometry(u * 0.028, u * 0.0045, 8, 20, Math.PI * 1.15),
    m.brightSteel,
  );
  guard.rotation.y = Math.PI / 2;
  guard.rotation.z = -Math.PI * 0.42;
  guard.position.set(0, -u * 0.036, u * 0.052);
  group.add(guard);
  for (const z of [u * 0.036, u * 0.056]) {
    const trigger = part(group, m.brightSteel, u * 0.006, u * 0.022, u * 0.007, 0, -u * 0.042, z);
    trigger.rotation.x = 0.35;
  }

  // --- Stock --------------------------------------------------------------
  /*
   * Wrist, comb and butt, each angled a little more than the last so the stock
   * *drops* away from the barrel line — a straight stock is the other classic
   * tell of a modelled gun, and the drop is what puts a shooter's eye on the
   * rib.
   */
  const wrist = part(group, m.walnutChequered, u * 0.05, u * 0.056, u * 0.15, 0, -u * 0.016, u * 0.15);
  wrist.rotation.x = -0.07;
  const comb = part(group, m.walnut, u * 0.052, u * 0.06, u * 0.14, 0, -u * 0.032, u * 0.26);
  comb.rotation.x = -0.14;
  const butt = part(group, m.walnut, u * 0.056, u * 0.086, u * 0.1, 0, -u * 0.05, u * 0.35);
  butt.rotation.x = -0.16;
  // Cheek piece along the comb, and the pad on the end with its white spacer.
  part(group, m.walnut, u * 0.03, u * 0.03, u * 0.16, u * 0.014, -u * 0.012, u * 0.24).rotation.x =
    -0.14;
  const spacer = part(group, m.ebony, u * 0.058, u * 0.09, u * 0.006, 0, -u * 0.056, u * 0.397);
  spacer.rotation.x = -0.16;
  const pad = part(group, m.vulcanite, u * 0.058, u * 0.092, u * 0.016, 0, -u * 0.058, u * 0.406);
  pad.rotation.x = -0.16;
  if (fine) {
    // Rear sling swivel, and the grip cap at the wrist.
    const swivel = new THREE.Mesh(
      new THREE.TorusGeometry(u * 0.01, u * 0.0024, 7, 16),
      m.brightSteel,
    );
    swivel.rotation.y = Math.PI / 2;
    swivel.position.set(0, -u * 0.072, u * 0.33);
    group.add(swivel);
  }

  // --- Fore-end -----------------------------------------------------------
  /*
   * The wood under the barrels, with a chequered panel where the support hand
   * grips it and an ebony tip — the two features that make a fore-end look
   * fitted rather than glued on.
   */
  const foreEnd = part(group, m.walnutChequered, u * 0.062, u * 0.05, u * 0.19, 0, -u * 0.016, -u * 0.16);
  foreEnd.castShadow = true;
  part(group, m.ebony, u * 0.056, u * 0.042, u * 0.018, 0, -u * 0.014, -u * 0.262);
  if (fine) {
    // The fore-end iron and its escutcheon, along the top of the wood.
    part(group, m.receiver, u * 0.03, u * 0.008, u * 0.16, 0, u * 0.006, -u * 0.16).castShadow = false;
  }

  return { group, muzzle: new THREE.Vector3(0, u * 0.012, barrelZ - barrelLen / 2 - u * 0.01) };
}

/**
 * The shotgun as its owner sees it, hands included.
 *
 * Scaled and posed for the camera rather than for the world: a viewmodel is
 * always a little smaller and a little closer than the real proportions, which
 * is what keeps it out of the middle of the screen while still reading as the
 * same object other players see on the hunter's model.
 */
export function buildShotgunViewmodel(): THREE.Group {
  const m = weaponMaterials();
  const group = new THREE.Group();
  const u = 1.05;
  const gun = buildShotgun(u, true);
  group.add(gun.group);

  /*
   * ## The hands
   *
   * They were two brown blocks with four sticks on top. At this scale — the
   * closest object in the game to the camera — that is the difference between a
   * gun being *held* and a gun floating with two boxes near it. Each hand is a
   * palm, a thenar pad, four fingers of two segments each curled around the
   * wood, and a thumb laid along it. Knuckles come free from the segment joints.
   */
  const buildHand = (z: number, y: number, mirrored: boolean): void => {
    const hand = new THREE.Group();
    hand.position.set(0, y, z);
    if (mirrored) hand.rotation.y = Math.PI;
    group.add(hand);

    // Palm and the muscle at the base of the thumb.
    part(hand, m.skin, u * 0.05, u * 0.044, u * 0.07, 0, 0, 0);
    const thenar = new THREE.Mesh(new THREE.SphereGeometry(u * 0.022, 12, 8), m.skin);
    thenar.scale.set(0.7, 1, 1.2);
    thenar.position.set(u * 0.018, u * 0.008, u * 0.012);
    hand.add(thenar);

    for (let f = 0; f < 4; f++) {
      const reach = 1 - Math.abs(f - 1.2) * 0.09;
      const zz = -u * 0.026 + f * u * 0.018;
      // Proximal segment lying over the top of the wood…
      const prox = part(hand, m.skin, u * 0.05 * reach, u * 0.013, u * 0.014, -u * 0.004, u * 0.026, zz);
      prox.rotation.z = 0.12;
      // …and the tip curling down the far side, which is what makes a hand
      // look wrapped around something instead of resting on it.
      const tip = part(hand, m.skin, u * 0.018, u * 0.012, u * 0.013, -u * 0.03 * reach, u * 0.018, zz);
      tip.rotation.z = -0.8;
      // A knuckle over the joint.
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(u * 0.0075, 8, 6), m.skin);
      knuckle.position.set(u * 0.019, u * 0.028, zz);
      hand.add(knuckle);
    }
    // Thumb, along the wood rather than around it.
    const thumb = part(hand, m.skin, u * 0.014, u * 0.017, u * 0.046, u * 0.026, u * 0.012, u * 0.01);
    thumb.rotation.x = 0.2;
  };

  // Trigger hand at the wrist, support hand out on the fore-end.
  buildHand(u * 0.07, -u * 0.05, false);
  buildHand(-u * 0.155, -u * 0.05, true);

  return group;
}
