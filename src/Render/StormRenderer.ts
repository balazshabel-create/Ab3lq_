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
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    // The cylinder's outward normal, in world space. Used to sharpen the wall:
    // seen face-on you look through a metre of rain, seen edge-on through
    // fifty, and that difference is most of what makes it read as a *volume*.
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const wallFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  uniform float uTime;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform vec3 uFlashColor;
  uniform vec3 uEdgeColor;
  uniform float uFlash;
  uniform float uShrink;
  uniform float uOpacity;
  uniform vec3 uCameraPos;
  /*
   * Lane density, scaled by the circle's size.
   *
   * The filaments are laid out in the cylinder's uv, so a fixed count spreads
   * them further apart as the circle grows — at the opening radius they were
   * ten metres apart and read as a stage curtain, while in the last circle they
   * would have been on top of each other. Scaling by the radius keeps a
   * filament every couple of metres whatever the circle is doing.
   */
  uniform float uLanes;

  /*
   * Turbulence from four octaves of crossing sines.
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

  /*
   * Filaments: thin, bright, and travelling upwards.
   *
   * The old wall was one soft mass of turbulence, which from inside the circle
   * looked like fog on the lens rather than like a barrier. What gives a wall
   * an *edge* is high-frequency structure with gaps in it — you can see through
   * the gaps, and that is what tells the eye there is a surface there rather
   * than a haze in front of the camera.
   */
  float filamentLayer(vec2 p, float lanes, float speed, float phase) {
    float lane = p.x * lanes + phase;
    float rise = p.y * 2.2 - uTime * speed;
    float wobble = sin(lane * 0.35 + uTime * 0.9) * 0.15;
    float band = sin((lane + wobble * 40.0) * 3.14159 + sin(rise * 6.2831) * 1.4);
    // Sharpened into ribbons: most of the width is dark, the peaks are hot.
    return pow(clamp(band * 0.5 + 0.5, 0.0, 1.0), 3.0);
  }

  float filaments(vec2 p) {
    /*
     * Three layers at unrelated spacings.
     *
     * One layer sharpened into ribbons is a picket fence: evenly spaced bright
     * lines with clean gaps between them, which from inside the circle reads as
     * light shafts rather than as weather. Layering three at frequencies that
     * are not multiples of each other fills the gaps unevenly, which is what a
     * curtain of rain actually looks like.
     */
    float a = filamentLayer(p, 260.0 * uLanes, 0.55, 0.0);
    float b = filamentLayer(p, 431.0 * uLanes, 0.82, 1.7);
    float c = filamentLayer(p, 97.0 * uLanes, 0.34, 3.9);
    return clamp(a * 0.5 + b * 0.35 + c * 0.45, 0.0, 1.0);
  }

  void main() {
    float streaks = turbulence(vUv);
    float thread = filaments(vUv);

    /*
     * How much rain is in the line of sight.
     *
     * Face-on this is a thin sheet; at a glancing angle the ray travels along
     * the wall and passes through far more of it. Multiplying the opacity by
     * the reciprocal of the facing term reproduces that, and it is what stops
     * the wall from being a uniform grey film over everything behind it.
     */
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float facing = abs(dot(viewDir, vNormalW));
    /*
     * One wall-thickness face-on, up to two at a glancing angle. The first
     * version used 0.55 as the numerator, which made the wall *thinner* than
     * intended everywhere and thinnest exactly where a player looks at it —
     * straight on — so it read as a light haze with some streaks in it.
     */
    float depthThrough = clamp(1.0 / max(0.25, facing), 1.0, 2.0);

    /*
     * Denser at the bottom: the base of a squall is where the rain is.
     *
     * The exponent matters more than it looks. At 0.7 the term is already down
     * to a half a quarter of the way up — which is exactly the band a standing
     * player looks at — so the wall was half transparent precisely where it had
     * to be solid. At 2.2 it holds near one for the lower third and then falls
     * away, which is the shape of an actual squall line.
     */
    float vertical = 1.0 - pow(clamp(vUv.y, 0.0, 1.0), 2.2);
    // Ragged top edge, so the wall does not end in a straight line.
    float top = 1.0 - smoothstep(0.5, 1.0, vUv.y - streaks * 0.26);
    /*
     * The base line: a hard, bright rim where the wall meets the ground.
     *
     * This is the single most useful pixel in the effect. The damage starts at
     * a *line on the floor*, and a player needs to know which side of it they
     * are standing on — a soft gradient cannot answer that, so the bottom two
     * per cent of the wall is a lit edge.
     */
    float rim = smoothstep(0.07, 0.0, vUv.y);

    vec3 color = mix(uColorLow, uColorHigh, clamp(vUv.y * 1.3, 0.0, 1.0));
    color += uEdgeColor * thread * 1.05;
    color = mix(color, uFlashColor, uFlash * (0.35 + streaks * 0.65));
    // While the wall is moving it glows, which is the "it is closing" tell.
    color += uFlashColor * uShrink * 0.22 * (streaks + thread);
    color = mix(color, uEdgeColor, rim * 0.8);

    // A body between the filaments, so the wall is a mass with structure in it
    // rather than a set of bright lines with the jungle visible between them.
    float mass = 0.8 + streaks * 0.4 + thread * 0.8;
    float alpha = uOpacity * vertical * top * mass * depthThrough;
    alpha = max(alpha, rim * 0.95 * top);
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
        /*
         * Darker and bluer than the sky it stands against. The wall used to be
         * the same value as an overcast horizon, so at range it read as haze;
         * what makes it unmistakable is that it is *darker* than the sky behind
         * it with bright filaments running up it.
         */
        uColorLow: { value: new THREE.Color(0x171b30) },
        uColorHigh: { value: new THREE.Color(0x3b4270) },
        uFlashColor: { value: new THREE.Color(0xdce6ff) },
        // The filaments and the ground line. Violet rather than white: it has
        // to be a colour nothing else in a jungle has, so the wall is never
        // mistaken for mist or for the sky.
        uEdgeColor: { value: new THREE.Color(0x9d7dff) },
        uFlash: { value: 0 },
        uShrink: { value: 0 },
        uOpacity: { value: 1 },
        uCameraPos: { value: new THREE.Vector3() },
        uLanes: { value: 1 },
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
  update(circle: StormCircle | null, dt: number, time: number, cameraPos: THREE.Vector3): void {
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
    wu.uCameraPos.value.copy(cameraPos);
    /*
     * Left at the count that was tuned by eye.
     *
     * Scaling it to hold the spacing constant in metres was tried and reverted:
     * at the opening radius it put eleven hundred filaments around the
     * cylinder, far finer than the wall's own turbulence, and they averaged
     * into flat grey — the structure disappeared exactly when the wall is
     * biggest and most visible.
     */
    wu.uLanes.value = 1;
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
