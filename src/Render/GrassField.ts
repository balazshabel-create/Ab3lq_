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
 * The result is roughly one tuft per one and a half square metres near the
 * camera — twenty times the old density — for a bounded cost that does not
 * depend on the size of the world at all.
 */

import * as THREE from 'three';
import { clamp01 } from '../Systems/Noise';
import type { Terrain } from '../World/Terrain';
import type { GraphicsSettings } from '../Graphics/QualitySettings';
import { applyWind, buildGrassTuftGeometry, vertexColorMaterial } from './FoliageRenderer';

/** Chunk edge length in metres. */
const CHUNK = 14;

/**
 * Cap on how far the dense field reaches, in metres.
 *
 * Independent of the preset's `grassDistance`, and deliberately short. Coverage
 * area grows as the square of the radius, so most of the instances in a 46 m ring
 * are in the outermost few metres, where a fifteen-centimetre tuft is two pixels
 * tall and contributes nothing. Spending that budget on the near field instead is
 * what pays for the density. The cutoff is not visible for the same reason it is
 * cheap to remove: there is almost nothing there to see.
 */
const MAX_REACH = 26;

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
const TUFT_DENSITY = 3.2;

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
}

export class GrassField {
  private group = new THREE.Group();
  private geometry: THREE.BufferGeometry;
  private material: THREE.Material;
  private chunks = new Map<number, GrassChunk>();
  private pool: THREE.InstancedMesh[] = [];
  private pending: { cx: number; cz: number }[] = [];
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
    this.geometry = buildGrassTuftGeometry();
    this.material = vertexColorMaterial({ side: THREE.DoubleSide });
    // Same wind shader as the rest of the foliage, so a gust moves the whole
    // jungle together rather than the bushes and the grass disagreeing.
    applyWind(this.material, 1.9);
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

    // --- Retire what has gone out of range --------------------------------
    for (const [key, chunk] of this.chunks) {
      const cx = (chunk.cx + 0.5) * CHUNK;
      const cz = (chunk.cz + 0.5) * CHUNK;
      const dx = cx - cameraPos.x;
      const dz = cz - cameraPos.z;
      if (dx * dx + dz * dz > keepSq) {
        this.group.remove(chunk.mesh);
        this.pool.push(chunk.mesh);
        this.chunks.delete(key);
      }
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
        this.pending.push({ cx: i, cz: j });
      }
    }
    // Nearest first, so what the player is standing in appears before the edge.
    this.pending.sort((a, b) => {
      const da = Math.hypot((a.cx + 0.5) * CHUNK - cameraPos.x, (a.cz + 0.5) * CHUNK - cameraPos.z);
      const db = Math.hypot((b.cx + 0.5) * CHUNK - cameraPos.x, (b.cz + 0.5) * CHUNK - cameraPos.z);
      return da - db;
    });
    for (let n = 0; n < Math.min(BUILDS_PER_FRAME, this.pending.length); n++) {
      this.build(this.pending[n].cx, this.pending[n].cz);
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
  private build(cx: number, cz: number): void {
    const mesh = this.pool.pop() ?? this.newMesh();
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
        // Thin out where the foliage field is sparse, so clearings read as open.
        const density = this.terrain.foliageAt(x, z);
        const h2 = hash2(cx * 17 + i, cz * 29 + j, 7);
        if (h2.u > 0.25 + density * 1.1) continue;

        this.position.set(x, ground, z);
        this.quaternion.setFromAxisAngle(this.axis, h.u * Math.PI * 2);
        const s = 0.7 + h2.v * 0.8;
        this.scale.set(s, s * (0.7 + h.v * 0.9), s);
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
        const brightness = 0.68 + h2.v * 0.62;
        const dry = clamp01(1 - density * 1.3) * 0.4;
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
    this.chunks.set(chunkKey(cx, cz), { mesh, cx, cz });
  }

  private newMesh(): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.perChunk);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'grass-chunk';
    return mesh;
  }

  private retireAll(): void {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
      this.pool.push(chunk.mesh);
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
      for (const mesh of this.pool) mesh.dispose();
      this.pool.length = 0;
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
    for (const mesh of this.pool) mesh.dispose();
    this.pool.length = 0;
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

/** Signed chunk coordinates into one integer key. */
function chunkKey(cx: number, cz: number): number {
  // Offset so negative coordinates stay distinct, with room for a 4096-chunk map.
  return (cz + 2048) * 4096 + (cx + 2048);
}
