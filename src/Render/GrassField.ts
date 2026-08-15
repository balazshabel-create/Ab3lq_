/**
 * GrassField.ts — dense ground cover, streamed around the camera.
 *
 * ## Why this is not just more props
 *
 * Ground cover was originally scattered like every other prop: a fixed list
 * generated once for the whole map. That does not scale to *grass*. Measured on
 * the real world size, forty-two thousand scattered tufts works out at one tuft
 * per fourteen square metres — which on screen is a few lonely sprigs on bare
 * ground, not a rainforest floor. Reaching a believable density that way needs
 * something like three hundred thousand stored props, which is megabytes of
 * objects and a visible stall to place.
 *
 * The way out is that grass is only ever visible for a few dozen metres. So it
 * does not need to exist for the whole map — only in a ring of chunks around the
 * camera, generated on demand and recycled as the player walks. Positions come
 * from a hash of the chunk coordinate and the instance index, so a chunk
 * regenerates identically every time it is revisited and every client agrees,
 * with nothing stored between visits.
 *
 * The result is around seven and a half tufts per square metre, held all the way
 * out to seventy metres — well over a hundred thousand of them on screen — for a
 * bounded cost that does not depend on the size of the world at all. The cost is
 * bounded by a two-level LOD rather than by a short cull distance; see MAX_REACH.
 */

import * as THREE from 'three';
import { clamp01 } from '../Systems/Noise';
import type { Terrain } from '../World/Terrain';
import type { GraphicsSettings } from '../Graphics/QualitySettings';
import {
  applyNearFade,
  applyWind,
  buildGrassTuftGeometry,
  vertexColorMaterial,
} from './FoliageRenderer';

/** Chunk edge length in metres. */
const CHUNK = 14;

/**
 * Cap on how far the dense field reaches, in metres.
 *
 * This was 22, on the reasoning that coverage area grows as the square of the
 * radius so the outer ring is nearly all of the cost for nearly none of the
 * benefit. That reasoning is sound about *triangles* and wrong about *coverage*:
 * a 22 m cutoff means the ground stops being grass a couple of body lengths away
 * and becomes bare heightfield, and because the cut is a circle centred on the
 * camera it follows you around as a visible ring of baldness.
 *
 * Raised to 70 to match the high preset's `grassDistance`, so grass now reaches
 * as far as the setting claims. The triangle cost that used to justify the short
 * cutoff is paid for by the far LOD instead: past `LOD_DISTANCE` a tuft keeps its
 * footprint and colour but drops to a third of its blades — see
 * buildGrassTuftGeometry.
 */
const MAX_REACH = 70;

/**
 * Range past which chunks are built from the cheap tuft, in metres.
 *
 * Chosen from where a tuft stops being resolvable rather than from a budget: at
 * 25 m a half-metre clump is a few dozen pixels tall, and its individual blades
 * are sub-pixel. Everything past that contributes mass and colour only.
 */
const LOD_DISTANCE = 25;

/**
 * Tufts per square metre at full density.
 *
 * The number went up twice during tuning, and the reason is worth recording:
 * grass reads as grass through *density*, not through blade size. A sparse field
 * of tall blades looks like a handful of reeds stuck in a lawn no matter how good
 * the individual tuft is, and the instinct to fix that by making the blades
 * bigger makes it worse. So the tufts are small — about fifteen centimetres — and
 * there are a lot of them.
 */
const TUFT_DENSITY = 11;

/*
 * Density and reach no longer trade against each other, and that is the point of
 * the LOD.
 *
 * The earlier note here argued for buying density by cutting the reach, because
 * coverage area grows as the square of the radius and the outer ring is nearly
 * all of the cost. True, but it bought a dense patch surrounded by bare ground —
 * and the bare ground moved with the camera. Splitting the tuft into two blade
 * counts breaks the trade instead: the density stays high all the way out, and
 * the ring past 25 m pays a third of the triangles for it.
 */

/**
 * How many chunks may be built in one frame.
 *
 * Walking fast pulls a whole row of new chunks into range at once. Building them
 * all in the frame they appear is a visible hitch, and grass appearing a frame or
 * two late at the edge of the cull distance is genuinely unnoticeable.
 */
const BUILDS_PER_FRAME = 2;

/** Stable pseudo-random pair from three integers. No allocation. */
function hash2(a: number, b: number, c: number): { u: number; v: number } {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  const t = Math.sin(a * 269.5 + b * 183.3 + c * 246.1) * 24634.6345;
  return { u: s - Math.floor(s), v: t - Math.floor(t) };
}

interface GrassChunk {
  mesh: THREE.InstancedMesh;
  cx: number;
  cz: number;
  /** Which tuft geometry this chunk was built with. */
  lod: Lod;
}

type Lod = 'near' | 'far';

export class GrassField {
  private group = new THREE.Group();
  /** One tuft geometry per LOD, shared by every chunk at that level. */
  private geometry: Record<Lod, THREE.BufferGeometry>;
  private material: THREE.Material;
  private chunks = new Map<number, GrassChunk>();
  /** Free meshes, kept per LOD since the geometry is baked into the mesh. */
  private pool: Record<Lod, THREE.InstancedMesh[]> = { near: [], far: [] };
  private pending: { cx: number; cz: number; lod: Lod }[] = [];
  private settings: GraphicsSettings;
  private terrain: Terrain;
  /** Instances per chunk at the current preset. */
  private perChunk = 0;

  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private axis = new THREE.Vector3(0, 1, 0);
  private tint = new THREE.Color();

  constructor(scene: THREE.Scene, terrain: Terrain, settings: GraphicsSettings) {
    this.terrain = terrain;
    this.settings = settings;
    this.geometry = {
      near: buildGrassTuftGeometry('near'),
      far: buildGrassTuftGeometry('far'),
    };
    this.material = vertexColorMaterial({ side: THREE.DoubleSide });
    // Same wind shader as the rest of the foliage, so a gust moves the whole
    // jungle together rather than the bushes and the grass disagreeing.
    applyWind(this.material, 1.9);
    /*
     * Two metres: about one body length for the animals with the lowest cameras,
     * which are the ones that were being blinded. Wide enough that the player is
     * never looking through a blade, narrow enough that the patch is not visible
     * as a clearing following them around.
     */
    applyNearFade(this.material, 2.0);
    this.group.name = 'grass-field';
    scene.add(this.group);
    this.recomputeBudget();
  }

  private recomputeBudget(): void {
    const density = clamp01(this.settings.foliageDensity) * TUFT_DENSITY;
    this.perChunk = Math.max(0, Math.round(CHUNK * CHUNK * density));
  }

  /**
   * Keep the ring of chunks centred on the camera.
   *
   * Two passes: work out which chunks should exist, retire the ones that should
   * not, then build a bounded number of the missing ones.
   */
  update(cameraPos: THREE.Vector3, time: number, wind: number): void {
    const reach = Math.min(this.settings.grassDistance, MAX_REACH);
    if (this.perChunk === 0 || reach <= 0) {
      this.retireAll();
      return;
    }

    const ccx = Math.floor(cameraPos.x / CHUNK);
    const ccz = Math.floor(cameraPos.z / CHUNK);
    const span = Math.ceil(reach / CHUNK);
    // Compare squared distances against the chunk centre, with the chunk's own
    // half-diagonal added so a chunk is kept while any part of it is in range.
    const keepRadius = reach + CHUNK * 0.75;
    const keepSq = keepRadius * keepRadius;

    /*
     * Which LOD a chunk wants, from its nearest corner rather than its centre.
     *
     * Using the centre would let a 14 m chunk whose near edge is 19 m away be
     * built from the cheap tuft, and its near edge is close enough to see the
     * missing blades. Hysteresis (a wider band for keeping than for switching)
     * stops a chunk sitting exactly on the boundary from rebuilding every frame
     * as the player shuffles.
     */
    const lodFor = (i: number, j: number, hysteresis: number): Lod => {
      const nearX = Math.max(i * CHUNK, Math.min(cameraPos.x, (i + 1) * CHUNK));
      const nearZ = Math.max(j * CHUNK, Math.min(cameraPos.z, (j + 1) * CHUNK));
      const d = Math.hypot(nearX - cameraPos.x, nearZ - cameraPos.z);
      return d <= LOD_DISTANCE + hysteresis ? 'near' : 'far';
    };

    /*
     * --- Retire what has gone out of range ---------------------------------
     *
     * Out-of-range chunks can be dropped on the spot: they are past the cull
     * distance, so nobody sees them go.
     *
     * An LOD change is a different matter and must never be handled this way.
     * The first version deleted the chunk and let the ordinary build queue
     * replace it, which meant the replacement competed for a bounded per-frame
     * budget — and as the player walks, the LOD boundary sweeps through a whole
     * ring of chunks at once. Every one of them vanished and came back several
     * frames later, so there was a permanent bare annulus about 25 m out that
     * followed the camera around. That is the gap in the grass.
     *
     * So LOD changes are collected and swapped *in place* below: build the
     * replacement first, then release the old mesh. The ground is never empty.
     */
    const relod: GrassChunk[] = [];
    for (const [key, chunk] of this.chunks) {
      const cx = (chunk.cx + 0.5) * CHUNK;
      const cz = (chunk.cz + 0.5) * CHUNK;
      const dx = cx - cameraPos.x;
      const dz = cz - cameraPos.z;
      if (dx * dx + dz * dz > keepSq) {
        this.group.remove(chunk.mesh);
        this.pool[chunk.lod].push(chunk.mesh);
        this.chunks.delete(key);
        continue;
      }
      // Keep an existing chunk at its current level within a 6 m dead band.
      const wants = lodFor(chunk.cx, chunk.cz, chunk.lod === 'near' ? 6 : -6);
      if (wants !== chunk.lod) relod.push(chunk);
    }

    // --- Queue what is missing --------------------------------------------
    this.pending.length = 0;
    for (let j = ccz - span; j <= ccz + span; j++) {
      for (let i = ccx - span; i <= ccx + span; i++) {
        const key = chunkKey(i, j);
        if (this.chunks.has(key)) continue;
        const cx = (i + 0.5) * CHUNK;
        const cz = (j + 0.5) * CHUNK;
        const dx = cx - cameraPos.x;
        const dz = cz - cameraPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > keepSq) continue;
        this.pending.push({ cx: i, cz: j, lod: lodFor(i, j, 0) });
      }
    }
    // Nearest first, so what the player is standing in appears before the edge.
    this.pending.sort((a, b) => {
      const da = Math.hypot((a.cx + 0.5) * CHUNK - cameraPos.x, (a.cz + 0.5) * CHUNK - cameraPos.z);
      const db = Math.hypot((b.cx + 0.5) * CHUNK - cameraPos.x, (b.cz + 0.5) * CHUNK - cameraPos.z);
      return da - db;
    });
    /*
     * A larger build budget than before, scaled by how much is outstanding.
     *
     * The reach went from 22 m to 70 m, which is ten times the chunks — at two
     * builds a frame the field would take the best part of a minute to fill in,
     * and the player would watch grass creep towards them. Building more per
     * frame while there is a backlog, and dropping back to a trickle once the
     * ring is full, keeps the steady-state cost where it was.
     */
    const budget = this.pending.length > 24 ? BUILDS_PER_FRAME * 5 : BUILDS_PER_FRAME;
    for (let n = 0; n < Math.min(budget, this.pending.length); n++) {
      this.build(this.pending[n].cx, this.pending[n].cz, this.pending[n].lod);
    }

    /*
     * --- Swap LOD levels in place ------------------------------------------
     *
     * Nearest first, and only a few a frame, because each one is a full chunk
     * rebuild. `build` registers the new chunk over the old key, so the old mesh
     * has to be released afterwards — and only afterwards, which is the whole
     * point: at no instant is there no grass at that spot.
     */
    if (relod.length > 0) {
      relod.sort((a, b) => {
        const da = Math.hypot((a.cx + 0.5) * CHUNK - cameraPos.x, (a.cz + 0.5) * CHUNK - cameraPos.z);
        const db = Math.hypot((b.cx + 0.5) * CHUNK - cameraPos.x, (b.cz + 0.5) * CHUNK - cameraPos.z);
        return da - db;
      });
      for (let n = 0; n < Math.min(BUILDS_PER_FRAME * 2, relod.length); n++) {
        const old = relod[n];
        const wants: Lod = old.lod === 'near' ? 'far' : 'near';
        this.build(old.cx, old.cz, wants);
        this.group.remove(old.mesh);
        this.pool[old.lod].push(old.mesh);
      }
    }

    // --- Wind -------------------------------------------------------------
    const u = (
      this.material as THREE.Material & {
        userData: { windUniforms?: { uTime: { value: number }; uWind: { value: number } } };
      }
    ).userData.windUniforms;
    if (u) {
      u.uTime.value = time;
      u.uWind.value = 0.25 + wind * 1.4;
    }

    // Where to shrink the blades. See applyNearFade.
    const fade = (
      this.material as THREE.Material & {
        userData: { nearFadeUniforms?: { uFadeCamera: { value: THREE.Vector3 } } };
      }
    ).userData.nearFadeUniforms;
    if (fade) fade.uFadeCamera.value.copy(cameraPos);
  }

  /**
   * Fill one chunk.
   *
   * Tufts land on a jittered grid rather than at fully random points: pure random
   * placement clumps, leaving bald patches next to dense knots, and at this
   * density the clumping is the thing you notice. A jittered grid reads as even
   * cover while still looking unplanned.
   *
   * Placement respects the terrain the same way the scattered props do — no grass
   * in the water, none on bare rock, and thinner where the foliage field says the
   * ground is open — so a clearing stays legibly a clearing.
   */
  private build(cx: number, cz: number, lod: Lod): void {
    const mesh = this.pool[lod].pop() ?? this.newMesh(lod);
    const originX = cx * CHUNK;
    const originZ = cz * CHUNK;
    // Grid side that holds `perChunk` cells.
    const side = Math.max(1, Math.round(Math.sqrt(this.perChunk)));
    const step = CHUNK / side;

    let placed = 0;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        if (placed >= mesh.instanceMatrix.count) break;
        const h = hash2(cx * 73 + i, cz * 91 + j, i * 31 + j * 17);
        const x = originX + (i + h.u) * step;
        const z = originZ + (j + h.v) * step;

        if (!this.terrain.inBounds(x, z)) continue;
        const ground = this.terrain.heightAt(x, z);
        // Nothing grows below the waterline, and nothing grows on a cliff.
        if (ground < this.terrain.waterLevel + 0.12) continue;
        if (this.terrain.slopeAt(x, z) > 0.8) continue;
        /*
         * Thicker in the open, thinner under closed canopy — which is the
         * opposite of what this did before, and the wrong way round was both
         * unrealistic and worse looking.
         *
         * `foliageAt` is high where the *canopy* is dense, and a rainforest floor
         * under closed canopy is leaf litter and roots precisely because almost no
         * light reaches it. The ground cover is in the gaps: clearings, riverbanks,
         * the edges of the canopy. Keying grass to high canopy density put the
         * thickest grass in the darkest places and left the sunlit clearings —
         * where the eye actually goes — looking bald.
         *
         * The floor stays high (0.55 even under full canopy) because the ground
         * still has to be covered; this is a lean, not a switch.
         */
        const density = this.terrain.foliageAt(x, z);
        const h2 = hash2(cx * 17 + i, cz * 29 + j, 7);
        /*
         * The floor was 0.55, which threw away nearly half the grid under closed
         * canopy — and thinning a field by rejecting cells does not read as
         * "sparser grass", it reads as holes, because the survivors keep their
         * full size and the gaps between them are tuft-sized. Raised to 0.86 so
         * the lean towards open ground is a slight thinning rather than a
         * puncture; the *colour* drift below is what actually communicates shade.
         */
        if (h2.u > 0.86 + (1 - clamp01(density)) * 0.14) continue;

        this.position.set(x, ground, z);
        this.quaternion.setFromAxisAngle(this.axis, h.u * Math.PI * 2);
        /*
         * A much narrower size spread than before.
         *
         * The old range multiplied out to a 3.4× span between the smallest and
         * largest tuft, and the big end of that is what made the near field read
         * as a scattering of oversized individual leaves: a 2.4× tuft is a
         * 1.2 m blade standing next to the camera, which the eye reads as one
         * plant rather than as grass. Variation still matters — a uniform field
         * looks stamped — but it belongs in the tens of percent, not in factors.
         */
        const s = 0.8 + h2.v * 0.42;
        this.scale.set(s, s * (0.84 + h.v * 0.46), s);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        mesh.setMatrixAt(placed, this.matrix);

        /*
         * Colour.
         *
         * Wide brightness jitter plus a yellow-brown drift where the foliage
         * field says the ground is open. Without the drift the floor is one flat
         * green — which is the single thing that most makes a procedural
         * landscape look procedural — and with it a clearing edge reads as
         * sun-bleached grass shading into deep shade under the canopy.
         */
        /*
         * A gentler multiplier than before, because the blades now carry their
         * own root-to-tip colour ramp. This tint used to be the *only* colour
         * variation grass had, so it swung hard; leaving it that wide now washes
         * the ramp out and puts the flat look straight back.
         */
        const brightness = 0.84 + h2.v * 0.34;
        const dry = clamp01(1 - density * 1.3) * 0.26;
        this.tint.setRGB(brightness + dry, brightness + dry * 0.45, brightness - dry * 0.5);
        mesh.setColorAt(placed, this.tint);
        placed++;
      }
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // A real bounding sphere, so a chunk behind the camera is frustum-culled.
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(originX + CHUNK / 2, this.terrain.heightAt(originX + CHUNK / 2, originZ + CHUNK / 2), originZ + CHUNK / 2),
      CHUNK * 1.2,
    );

    if (placed === 0) {
      // An all-water or all-rock chunk. Register it anyway, with zero instances,
      // so it is not re-evaluated every single frame.
      mesh.visible = false;
    } else {
      mesh.visible = true;
    }
    this.group.add(mesh);
    this.chunks.set(chunkKey(cx, cz), { mesh, cx, cz, lod });
  }

  private newMesh(lod: Lod): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry[lod], this.material, this.perChunk);
    /*
     * Near grass casts and receives; far grass does neither.
     *
     * Grass that casts no shadow at all sits *on* the ground rather than in it —
     * a field of tufts with no contact darkening under them reads as stickers on
     * a green plane, and no amount of density fixes it. The near ring is where
     * that is visible, and it is also the only part inside the 42 m shadow
     * frustum, so the far ring would gain nothing from being asked.
     *
     * Receiving matters as much as casting: it lets a tree's shadow fall across
     * the field instead of stopping at the terrain underneath it, which was the
     * single most obvious tell that the grass was a separate layer.
     *
     * Cost is bounded by the same LOD split that bounds everything else here —
     * roughly a tenth of the tufts are in the near ring.
     */
    const near = lod === 'near';
    mesh.castShadow = near;
    mesh.receiveShadow = near;
    mesh.name = 'grass-chunk';
    return mesh;
  }

  private retireAll(): void {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
      this.pool[chunk.lod].push(chunk.mesh);
    }
    this.chunks.clear();
  }

  setSettings(settings: GraphicsSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (settings.foliageDensity !== previous.foliageDensity) {
      this.recomputeBudget();
      // Instance capacity is baked into an InstancedMesh, so a density change
      // has to throw the pool away rather than resize it.
      for (const list of [this.pool.near, this.pool.far]) {
        for (const mesh of list) mesh.dispose();
        list.length = 0;
      }
      for (const chunk of this.chunks.values()) {
        this.group.remove(chunk.mesh);
        chunk.mesh.dispose();
      }
      this.chunks.clear();
    } else if (settings.grassDistance !== previous.grassDistance) {
      // The ring resizes itself on the next update; nothing to rebuild.
    }
  }

  /** Visible chunk count, for the debug overlay. */
  get visibleChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.mesh.visible) n++;
    return n;
  }

  get totalInstances(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.mesh.count;
    return n;
  }

  dispose(): void {
    this.retireAll();
    for (const list of [this.pool.near, this.pool.far]) {
      for (const mesh of list) mesh.dispose();
      list.length = 0;
    }
    this.geometry.near.dispose();
    this.geometry.far.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

/** Signed chunk coordinates into one integer key. */
function chunkKey(cx: number, cz: number): number {
  // Offset so negative coordinates stay distinct, with room for a 4096-chunk map.
  return (cz + 2048) * 4096 + (cx + 2048);
}
