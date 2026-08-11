/**
 * CameraRig.ts — the third-person camera.
 *
 * Third person rather than first person for a specific gameplay reason: this is
 * a game about *how your animal looks to other people*. If you could not see
 * your own capybara, you could not tell whether you were moving like one, and
 * "act like an AI animal" would be an instruction you had no feedback on.
 *
 * The rig also has to cope with animals whose sizes differ by two orders of
 * magnitude — a poison dart frog is 14 cm long and an anaconda is 4.6 m — so
 * every distance is derived from the target's body size rather than fixed.
 */

import * as THREE from 'three';
import { Terrain } from '../World/Terrain';
import { ANIMALS, Species } from '../Animals/AnimalTypes';
import { clamp, clamp01, lerp } from '../Systems/Noise';
import type { AnimalRenderer } from '../Render/AnimalRenderer';
import { WATER_LEVEL } from '../Systems/Config';

export class CameraRig {
  private camera: THREE.PerspectiveCamera;
  private terrain: Terrain;

  /** Actor id being followed. */
  private targetId = 0;
  private species: Species = Species.Capybara;

  /**
   * Orbit angles, driven by the mouse.
   * The default pitch looks slightly down at the animal, so the player can see
   * both their own gait and the ground around them — which is what they need in
   * order to judge whether they are moving like the AI nearby.
   */
  private yaw = 0;
  private pitch = 0.38;

  /** Smoothed focus point (the animal's shoulder height). */
  private focus = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private targetPos = new THREE.Vector3();

  /** Current orbit distance, smoothed so collisions do not snap the view. */
  private distance = 5;
  private targetDistance = 5;

  /** Shake amplitude, decayed each frame. */
  private shake = 0;

  /** Free-look camera for spectating and the main menu. */
  private freeMode = false;
  private freeAngle = 0;

  private tmp = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  /**
   * Optional test for solid scenery at a point.
   *
   * Terrain alone is not enough: in jungle this dense a five metre boom ends up
   * inside a trunk, a boulder or a cave mouth constantly, and the player's view
   * fills with the inside of an object. Supplied by the renderer, which already
   * knows where every prop is.
   */
  private blockerTest: ((x: number, y: number, z: number) => boolean) | null = null;

  constructor(camera: THREE.PerspectiveCamera, terrain: Terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.focus.set(0, 6, 0);
  }

  /** Give the rig a way to ask "is there scenery here?". */
  setBlockerTest(test: (x: number, y: number, z: number) => boolean): void {
    this.blockerTest = test;
  }

  setTarget(actorId: number): void {
    this.targetId = actorId;
  }

  /** The camera distance depends on how big the animal is. */
  setSpecies(species: Species): void {
    this.species = species;
    const def = ANIMALS[species];
    const size = Math.max(def.silhouette.length, def.silhouette.height);
    // A frog needs the camera almost on top of it; a 4.6 m anaconda needs room.
    this.targetDistance = clamp(1.4 + size * 1.9, 2.2, 11);
  }

  /** Mouse look. Deltas are in radians. */
  addLook(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, -0.55, 1.32);
  }

  /** Mouse wheel zoom, as a fraction of the species' default distance. */
  addZoom(delta: number): void {
    const def = ANIMALS[this.species];
    const size = Math.max(def.silhouette.length, def.silhouette.height);
    const base = clamp(1.4 + size * 1.9, 2.2, 11);
    this.targetDistance = clamp(this.targetDistance + delta, base * 0.55, base * 2.2);
  }

  /**
   * Where the player is looking.
   *
   * This steers *nothing*. Movement is body-relative — W drives along the
   * animal's own facing and A/D turn it — so the camera is free to point
   * anywhere, including straight back down the way you came, while the animal
   * keeps running forwards. The attack arc uses the body's yaw too, so a bite
   * always comes out of the animal's mouth rather than out of the camera.
   */
  get lookYaw(): number {
    return this.yaw;
  }

  get lookPitch(): number {
    return this.pitch;
  }

  /** Add a camera shake impulse (a bite landing, thunder, a hard landing). */
  addShake(amount: number): void {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /** Orbit the map slowly, for the main menu and for dead players. */
  setFreeMode(enabled: boolean): void {
    this.freeMode = enabled;
  }

  update(dt: number, animals: AnimalRenderer): void {
    if (this.freeMode || this.targetId === 0) {
      this.updateFreeCamera(dt);
      return;
    }

    // Follow the *rendered* position, not the last snapshot, so the camera is
    // as smooth as the animal it is watching.
    if (!animals.getPosition(this.targetId, this.targetPos)) {
      this.updateFreeCamera(dt);
      return;
    }

    const def = ANIMALS[this.species];
    const shoulder = Math.max(0.35, def.silhouette.height * 1.25);

    // Focus a little above the animal's back, and ahead of it when it moves.
    this.desired.set(this.targetPos.x, this.targetPos.y + shoulder, this.targetPos.z);
    // Critically damped follow: fast enough to feel connected, slow enough to
    // smooth out the 10 Hz snapshot stream.
    const k = 1 - Math.exp(-16 * dt);
    this.focus.lerp(this.desired, k);

    this.distance = lerp(this.distance, this.targetDistance, 1 - Math.exp(-8 * dt));

    // Spherical orbit around the focus point.
    const cosPitch = Math.cos(this.pitch);
    this.tmp.set(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    );
    this.tmpB.copy(this.focus).addScaledVector(this.tmp, this.distance);

    // --- Keep the camera out of the ground -------------------------------
    // Without this, looking up at a low animal buries the view in the terrain.
    const groundY = this.terrain.surfaceAt(this.tmpB.x, this.tmpB.z);
    const minY = groundY + 0.45;
    if (this.tmpB.y < minY) {
      this.tmpB.y = minY;
    }

    // March along the boom and stop at the first thing in the way — terrain or
    // scenery. Whichever is hit first wins, so the camera never ends up inside
    // a hill or inside a tree trunk.
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = lerp(this.focus.x, this.tmpB.x, t);
      const sz = lerp(this.focus.z, this.tmpB.z, t);
      const sy = lerp(this.focus.y, this.tmpB.y, t);

      const hitTerrain = sy < this.terrain.surfaceAt(sx, sz) + 0.3;
      const hitProp = this.blockerTest ? this.blockerTest(sx, sy, sz) : false;
      if (!hitTerrain && !hitProp) continue;

      // Shorten the boom to just before the obstruction.
      const shortened = this.distance * ((i - 1) / steps);
      this.tmpB.copy(this.focus).addScaledVector(this.tmp, Math.max(1.1, shortened));
      this.tmpB.y = Math.max(this.tmpB.y, this.terrain.surfaceAt(this.tmpB.x, this.tmpB.z) + 0.45);
      break;
    }

    this.camera.position.copy(this.tmpB);

    // --- Shake ------------------------------------------------------------
    if (this.shake > 0.001) {
      const s = this.shake * 0.16;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3.2);
    }

    this.camera.lookAt(this.focus);

    // Underwater tint is handled by the caller; here we only note the state.
    this.underwater = this.camera.position.y < WATER_LEVEL;
  }

  /** True when the camera itself is below the water line. */
  underwater = false;

  /** Point the orbit camera circles. Set by the menu to a scenic spot. */
  private freeAnchor = new THREE.Vector3(0, 0, 0);
  private freeRadius = 46;

  /**
   * Slow orbit of an anchor point.
   *
   * Used by the main menu's living background and by dead players spectating.
   * The camera sits above the canopy looking down into it, because the menu's
   * job is to show a rainforest — at eye level in dense jungle the view is a
   * wall of leaves two metres away.
   */
  private updateFreeCamera(dt: number): void {
    this.freeAngle += dt * 0.05;
    const x = this.freeAnchor.x + Math.cos(this.freeAngle) * this.freeRadius;
    const z = this.freeAnchor.z + Math.sin(this.freeAngle) * this.freeRadius;
    // Well above the tallest trees (~32 m) so the canopy reads as a canopy.
    const groundY = this.terrain.surfaceAt(x, z);
    this.camera.position.set(x, Math.max(groundY, this.freeAnchor.y) + 30, z);
    this.focus.set(this.freeAnchor.x, this.freeAnchor.y + 6, this.freeAnchor.z);
    this.camera.lookAt(this.focus);
  }

  /**
   * Choose what the free camera orbits.
   * The menu picks a riverbank: water plus canopy plus open sky in one shot.
   */
  setFreeAnchor(x: number, z: number, radius = 46): void {
    this.freeAnchor.set(x, this.terrain.surfaceAt(x, z), z);
    this.freeRadius = radius;
  }

  /** Reset orbit angles, e.g. on respawn. */
  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0.38;
    this.shake = 0;
  }

  /** How far the camera currently is from its target, for audio attenuation. */
  get currentDistance(): number {
    return this.distance;
  }

  /** Normalised 0..1 pitch, for the HUD's horizon indicator. */
  get pitchNormalised(): number {
    return clamp01((this.pitch + 0.55) / 1.87);
  }
}
