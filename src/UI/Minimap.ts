/**
 * Minimap.ts — the corner map, and the circle drawn on it.
 *
 * ## Why a map at all
 *
 * The round has a shrinking circle in it, and a circle you can only learn about
 * from a line of text is a circle you walk into. The HUD's strip says *when* the
 * storm moves and *how far* you are outside it; neither of those answers the
 * only question that matters while you are running, which is **which way**. That
 * is a picture, and this is the picture.
 *
 * ## How it is drawn
 *
 * Two layers, for two very different costs:
 *
 *  • **The world**, painted once into an offscreen canvas the first time a map
 *    is loaded. Sampling the heightfield is far too slow to do per frame — this
 *    is a hundred thousand height lookups — but the terrain never changes
 *    within a round, so it is a texture from then on.
 *  • **Everything that moves**, redrawn each frame on top: the safe circle, the
 *    next circle, the storm outside them, and the player.
 *
 * The map is player-centred and north-up. North-up because a rotating map costs
 * the player the one thing a map is for — a stable mental picture of where
 * things are — and player-centred because the question is always "where am I
 * relative to that circle", never "where is the circle in the world".
 */

import { WORLD_SIZE, WATER_LEVEL } from '../Systems/Config';

/** Everything the map needs to draw one frame. */
export interface MinimapState {
  x: number;
  z: number;
  /** Facing, in world radians, for the player arrow. */
  yaw: number;
  /** The live circle, or null when a round has none. */
  zone: {
    x: number;
    z: number;
    radius: number;
    shrinking: boolean;
    next: { x: number; z: number; radius: number } | null;
  } | null;
}

/** Half the width of the world the map shows, in metres. */
const VIEW_RADIUS = 190;

/** Resolution of the baked world layer. One texel is about three metres. */
const BAKE = 320;

export class Minimap {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private size = 190;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    // Drawn at device resolution: a map at CSS resolution on a retina display
    // is a blurred smear, and the whole point is legibility at a glance.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('minimap needs a 2D context');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);
    this.root.appendChild(this.canvas);
  }

  /**
   * Paint the world layer. Call once per map.
   *
   * `heightAt` is the terrain's own sampler, so the map is the same heightfield
   * the player is standing on rather than a second opinion about it.
   */
  setWorld(heightAt: (x: number, z: number) => number): void {
    const base = document.createElement('canvas');
    base.width = BAKE;
    base.height = BAKE;
    const ctx = base.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(BAKE, BAKE);
    const data = image.data;
    const half = WORLD_SIZE / 2;

    for (let j = 0; j < BAKE; j++) {
      for (let i = 0; i < BAKE; i++) {
        const x = -half + (i / (BAKE - 1)) * WORLD_SIZE;
        const z = -half + (j / (BAKE - 1)) * WORLD_SIZE;
        const h = heightAt(x, z);
        const depth = WATER_LEVEL - h;

        let r: number;
        let g: number;
        let b: number;
        if (depth > 0.3) {
          // Water, darkening with depth — the same read as the real surface, so
          // the deep channel and the lake are recognisable on the map.
          const t = Math.min(1, depth / 9);
          r = 46 - t * 24;
          g = 104 - t * 52;
          b = 116 - t * 40;
        } else if (depth > -1.2) {
          // The waterline: sand. A thin bright band that traces every river,
          // which is what makes the map readable at a glance.
          r = 178;
          g = 160;
          b = 118;
        } else {
          /*
           * Land, shaded by height with a little hill shading on top. Flat
           * colour by height alone gives contour bands; a slope term gives the
           * terrain a direction and the ridges become visible.
           */
          const t = Math.min(1, Math.max(0, (h - WATER_LEVEL) / 26));
          const slope = heightAt(x + 6, z) - heightAt(x - 6, z);
          const light = Math.max(-0.5, Math.min(0.5, slope * 0.09));
          r = (30 + t * 46) * (1 + light);
          g = (62 + t * 44) * (1 + light);
          b = (32 + t * 30) * (1 + light);
        }

        const idx = (j * BAKE + i) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.base = base;
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('visible', visible);
  }

  /** Draw one frame. */
  update(state: MinimapState): void {
    const ctx = this.ctx;
    const size = this.size;
    const mid = size / 2;
    // Metres to pixels.
    const scale = mid / VIEW_RADIUS;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    // Everything is clipped to the dial, so nothing spills into the HUD.
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#0a1410';
    ctx.fillRect(0, 0, size, size);

    // --- The world -------------------------------------------------------
    if (this.base) {
      const px = (state.x / WORLD_SIZE + 0.5) * BAKE;
      const pz = (state.z / WORLD_SIZE + 0.5) * BAKE;
      // How many baked texels fit across the visible span.
      const span = ((VIEW_RADIUS * 2) / WORLD_SIZE) * BAKE;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.base, px - span / 2, pz - span / 2, span, span, 0, 0, size, size);
    }

    const toScreen = (wx: number, wz: number): [number, number] => [
      mid + (wx - state.x) * scale,
      mid + (wz - state.z) * scale,
    ];

    // --- The storm -------------------------------------------------------
    if (state.zone) {
      const [cx, cy] = toScreen(state.zone.x, state.zone.z);
      const r = state.zone.radius * scale;

      /*
       * The storm is drawn as everything *outside* the circle rather than as a
       * ring on it. That is the honest picture — the danger is an area, not a
       * line — and it is also the one that answers the running player's
       * question without any counting: the safe part of the map is the part
       * that is not purple.
       */
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(157, 125, 255, 0.3)';
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = state.zone.shrinking ? '#e0d0ff' : '#9d7dff';
      ctx.lineWidth = state.zone.shrinking ? 2.5 : 1.8;
      ctx.stroke();

      // Where it is going next, dashed — so you can start walking before the
      // wall starts moving, which is the whole skill of playing a circle.
      if (state.zone.next) {
        const [nx, ny] = toScreen(state.zone.next.x, state.zone.next.z);
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.arc(nx, ny, state.zone.next.radius * scale, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();

    // --- The player ------------------------------------------------------
    /*
     * An arrow, not a dot: half of what the map has to say is which way you are
     * pointing. World yaw 0 is +X, which on this map is to the right, so the
     * arrow's own zero has to be rotated a quarter turn to match.
     */
    ctx.save();
    ctx.translate(mid, mid);
    ctx.rotate(state.yaw - Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // --- The dial itself --------------------------------------------------
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(126, 217, 87, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // North, so the map has an orientation you can trust.
    ctx.fillStyle = 'rgba(243, 237, 225, 0.7)';
    ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', mid, 13);
  }
}
