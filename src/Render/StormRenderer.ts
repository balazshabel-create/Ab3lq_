/**
 * StormRenderer.ts — the wall of weather at the edge of the circle.
 *
 * The storm zone is a gameplay rule that lives on the server (see StormZone.ts).
 * This is the part players actually experience, and it has one job above all
 * others: **be unmistakable from a long way off**. A boundary that does 20 %/s
 * and is not visible until you are standing in it is not a mechanic, it is a
 * trap. So the wall is tall, opaque, lit from inside by continuous lightning, and
 * has tornadoes standing behind it.
 *
 * Three pieces:
 *   • **The wall** — an open cylinder at the circle's radius, with a churning
 *     vertical shader. Repositioned and rescaled every frame from the
 *     authoritative circle, so what you see is exactly where the damage starts.
 *   • **Tornadoes** — a handful of funnels drifting around outside it, which is
 *     what makes the storm read as *weather* rather than as a fence.
 *   • **A shrink flash** — the wall brightens and thickens while it is moving,
 *     so a closing circle is legible without reading the HUD.
 *
 * Everything is procedural: sums of sines rather than noise textures, so there is
 * nothing to load and no memory cost.
 */

import * as THREE from 'three';
import { clamp01, lerp } from '../Systems/Noise';
import { Rng } from '../Systems/Rng';
import { TERRAIN_HEIGHT } from '../Systems/Config';
import type { GraphicsSettings } from '../Graphics/QualitySettings';

/** The circle, as the renderer needs it. Mirrors the wire type's geometry. */
export interface StormCircle {
  x: number;
  z: number;
  radius: number;
  shrinking: boolean;
}

/** How tall the wall stands. Well above the canopy, so it is never hidden. */
const WALL_HEIGHT = 260;

/** How far below zero the base is sunk, so hills never show a gap under it. */
const WALL_SINK = 60;

const TORNADO_COUNT = { low: 2, medium: 4, high: 6 } as const;

const wallVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const wallFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform vec3 uFlashColor;
  uniform float uFlash;
  uniform float uShrink;
  uniform float uOpacity;

  /*
   * Turbulence from three octaves of crossing sines.
   *
   * Not as good as real noise, but a wall of rain seen from a hundred metres is
   * mostly vertical streaks travelling sideways and upwards, which is exactly
   * what a few sines at different frequencies produce — and it costs no texture
   * fetch, which matters because this thing covers most of the screen when you
   * get near it.
   */
  float turbulence(vec2 p) {
    float v = 0.0;
    v += sin(p.x * 24.0 + uTime * 3.1 + sin(p.y * 5.0) * 2.0) * 0.5;
    v += sin(p.x * 61.0 - uTime * 5.4 + p.y * 9.0) * 0.28;
    v += sin(p.x * 132.0 + uTime * 8.2 - p.y * 3.0) * 0.14;
    v += sin(p.y * 17.0 - uTime * 6.0) * 0.2;
    return v * 0.5 + 0.5;
  }

  void main() {
    float streaks = turbulence(vUv);
    // Denser at the bottom: the base of a squall is where the rain is.
    float vertical = 1.0 - pow(clamp(vUv.y, 0.0, 1.0), 0.75);
    // Ragged top edge, so the wall does not end in a straight line.
    float top = 1.0 - smoothstep(0.55, 1.0, vUv.y - streaks * 0.22);

    vec3 color = mix(uColorLow, uColorHigh, clamp(vUv.y * 1.3, 0.0, 1.0));
    color = mix(color, uFlashColor, uFlash * (0.35 + streaks * 0.65));
    // While the wall is moving it glows, which is the "it is closing" tell.
    color += uFlashColor * uShrink * 0.18 * streaks;

    float alpha = uOpacity * vertical * top * (0.45 + streaks * 0.75);
    alpha *= 1.0 + uShrink * 0.35;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

const funnelFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uFlash;
  uniform float uSpin;

  void main() {
    // A spiral: the horizontal coordinate is advanced by height and by time, so
    // the bands wind up the funnel and rotate.
    float spiral = vUv.x * 6.0 + vUv.y * 9.0 - uTime * uSpin;
    float bands = sin(spiral * 3.1415) * 0.5 + 0.5;
    bands = pow(bands, 1.6);
    // Thin out at the top where the funnel meets the cloud base, and at the
    // very bottom where it touches down.
    float body = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
    vec3 color = uColor + vec3(uFlash * 0.5);
    gl_FragColor = vec4(color, clamp(body * (0.2 + bands * 0.55), 0.0, 1.0));
  }
`;

interface Tornado {
  mesh: THREE.Mesh;
  /** Angle around the circle, and how far outside it. */
  angle: number;
  offset: number;
  /** Radians per second it orbits the circle. */
  drift: number;
  scale: number;
}

export class StormRenderer {
  private group = new THREE.Group();
  private wall: THREE.Mesh;
  private wallMaterial: THREE.ShaderMaterial;
  private funnelMaterial: THREE.ShaderMaterial;
  private funnelGeometry: THREE.BufferGeometry;
  private tornadoes: Tornado[] = [];
  private settings: GraphicsSettings;
  /** Decaying lightning flash, so strikes fade rather than blink off. */
  private flash = 0;
  private nextStrike = 1.5;
  private rng = new Rng(0xf00d);

  constructor(scene: THREE.Scene, settings: GraphicsSettings) {
    this.settings = settings;

    this.wallMaterial = new THREE.ShaderMaterial({
      vertexShader: wallVertexShader,
      fragmentShader: wallFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColorLow: { value: new THREE.Color(0x2a2f42) },
        uColorHigh: { value: new THREE.Color(0x5b6486) },
        uFlashColor: { value: new THREE.Color(0xdce6ff) },
        uFlash: { value: 0 },
        uShrink: { value: 0 },
        uOpacity: { value: 0.9 },
      },
      transparent: true,
      // Seen from both sides: from inside the circle it is a wall ahead of you,
      // from out in the storm it is a wall between you and safety.
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });

    // Radius 1, height 1, open-ended — scaled to the live circle every frame.
    const wallGeometry = new THREE.CylinderGeometry(1, 1, 1, 96, 6, true);
    this.wall = new THREE.Mesh(wallGeometry, this.wallMaterial);
    this.wall.name = 'storm-wall';
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 3;
    this.group.add(this.wall);

    this.funnelMaterial = new THREE.ShaderMaterial({
      vertexShader: wallVertexShader,
      fragmentShader: funnelFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x3c4257) },
        uFlash: { value: 0 },
        uSpin: { value: 2.4 },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });

    // A funnel: wide at the cloud base, narrow at the ground. Built upside down
    // relative to a cone so the taper runs the right way.
    this.funnelGeometry = new THREE.CylinderGeometry(0.42, 0.06, 1, 20, 8, true);

    this.group.name = 'storm';
    this.group.visible = false;
    scene.add(this.group);
    this.buildTornadoes();
  }

  private buildTornadoes(): void {
    for (const t of this.tornadoes) {
      this.group.remove(t.mesh);
    }
    this.tornadoes.length = 0;

    const quality = this.settings.effectsQuality;
    if (quality === 'off') return;
    const count = TORNADO_COUNT[quality as 'low' | 'medium' | 'high'] ?? TORNADO_COUNT.low;

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.funnelGeometry, this.funnelMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.tornadoes.push({
        mesh,
        angle: (i / count) * Math.PI * 2 + this.rng.range(-0.4, 0.4),
        // Spread them through the storm rather than lining them up on the wall.
        offset: this.rng.range(40, 260),
        // Alternating drift directions, so they never look like a carousel.
        drift: this.rng.range(0.012, 0.045) * (i % 2 === 0 ? 1 : -1),
        scale: this.rng.range(0.7, 1.6),
      });
    }
  }

  /**
   * Place the wall and the funnels for this frame.
   *
   * `circle` is the authoritative one from the server, so the visible boundary
   * and the damaging boundary are the same circle by construction.
   */
  update(circle: StormCircle | null, dt: number, time: number): void {
    if (!circle || circle.radius <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // --- Lightning ---------------------------------------------------------
    // Continuous, irregular, and much more frequent than the weather system's
    // storms: this is the one place in the game where lightning is constant.
    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) {
      this.nextStrike = this.rng.range(0.35, 2.2);
      this.flash = this.rng.range(0.45, 1);
    }

    const shrink = circle.shrinking ? 1 : 0;

    // --- The wall ----------------------------------------------------------
    this.wall.position.set(circle.x, WALL_HEIGHT / 2 - WALL_SINK, circle.z);
    this.wall.scale.set(circle.radius, WALL_HEIGHT, circle.radius);
    const wu = this.wallMaterial.uniforms;
    wu.uTime.value = time;
    wu.uFlash.value = this.flash;
    // Eased rather than switched, so the glow ramps in when a shrink begins.
    wu.uShrink.value = lerp(wu.uShrink.value as number, shrink, Math.min(1, dt * 3));

    // --- Tornadoes ---------------------------------------------------------
    const fu = this.funnelMaterial.uniforms;
    fu.uTime.value = time;
    fu.uFlash.value = this.flash * 0.6;

    for (const t of this.tornadoes) {
      t.angle += t.drift * dt;
      const r = circle.radius + t.offset;
      const x = circle.x + Math.cos(t.angle) * r;
      const z = circle.z + Math.sin(t.angle) * r;
      // Funnels are tall and thin; the height is what makes them read at range.
      const height = WALL_HEIGHT * 0.78 * t.scale;
      const width = 34 * t.scale;
      t.mesh.position.set(x, height / 2 - TERRAIN_HEIGHT, z);
      t.mesh.scale.set(width, height, width);
      // A slow lean, so they are not perfectly vertical pillars.
      t.mesh.rotation.z = Math.sin(time * 0.21 + t.angle) * 0.09;
      t.mesh.rotation.x = Math.cos(time * 0.17 + t.angle) * 0.07;
    }
  }

  /**
   * How exposed the camera is, 0..1 — used for the screen overlay and audio.
   *
   * Ramped over the first sixty metres outside so walking into the storm is a
   * gradient, not a light switch. Matches `stormIntensity` in StormZone, which is
   * what the simulation uses for the same idea.
   */
  intensityAt(circle: StormCircle | null, x: number, z: number): number {
    if (!circle) return 0;
    const outward = Math.hypot(x - circle.x, z - circle.z) - circle.radius;
    return clamp01(outward / 60);
  }

  /** Current lightning flash, so the renderer can blow out the exposure. */
  get flashLevel(): number {
    return this.flash;
  }

  setSettings(settings: GraphicsSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (settings.effectsQuality !== previous.effectsQuality) this.buildTornadoes();
  }

  dispose(): void {
    this.wall.geometry.dispose();
    this.funnelGeometry.dispose();
    this.wallMaterial.dispose();
    this.funnelMaterial.dispose();
    this.group.removeFromParent();
  }
}
