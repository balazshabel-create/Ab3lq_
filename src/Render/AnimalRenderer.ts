/**
 * AnimalRenderer.ts — turns snapshots into moving animals.
 *
 * Three responsibilities:
 *
 *  1. Pooling. Models are expensive to build and there are hundreds of animals,
 *     so models are recycled per species and never rebuilt mid-round.
 *  2. Level of detail. Only the nearest handful get fully articulated models;
 *     the rest get a simplified one, and anything past the view distance is not
 *     drawn at all.
 *  3. Animation. This is the gameplay-critical part: the gait, the head bob,
 *     the tail sway and the idle breathing are what a player has to imitate,
 *     and they are driven purely from the snapshot fields that a player animal
 *     and an AI animal both have. There is no code path that animates a player
 *     differently from an AI, which is what makes the disguise honest.
 */

import * as THREE from 'three';
import { ANIMALS, BodyPlan, Species } from '../Animals/AnimalTypes';
import { ActorFlags } from '../Core/Types';
import type { SnapshotActor } from '../Networking/Protocol';
import type { GraphicsSettings } from '../Graphics/QualitySettings';
import { buildAnimalModel, type AnimalModel } from './AnimalModels';
import { clamp01, lerp } from '../Systems/Noise';

/** Client-side interpolation state for one actor. */
interface RenderActor {
  id: number;
  species: Species;
  model: AnimalModel | null;
  /** Detail level of the currently assigned model. */
  detail: number;
  /** Interpolated render position. */
  pos: THREE.Vector3;
  /** Latest authoritative position. */
  target: THREE.Vector3;
  /** Interpolated yaw. */
  yaw: number;
  targetYaw: number;
  gait: number;
  flags: number;
  flies: number;
  /** Animation phase, advanced by speed so footfalls line up with movement. */
  phase: number;
  /** Seconds since this actor last appeared in a snapshot. */
  stale: number;
  /** Blend-in factor, so animals fade in rather than popping. */
  fade: number;
  distance: number;
  /**
   * Whether this animal is in water, recomputed each frame.
   *
   * Deliberately derived on the client from the terrain rather than sent in the
   * snapshot: the client already knows the heightfield, so spending wire bytes
   * on something it can work out for itself would be waste.
   */
  inWater: boolean;
}

const MODEL_DETAIL_NEAR = 1;
const MODEL_DETAIL_FAR = 0.3;

export class AnimalRenderer {
  private group = new THREE.Group();
  private actors = new Map<number, RenderActor>();
  /** Free models, keyed by `species:detail`. */
  private pool = new Map<string, AnimalModel[]>();
  private settings: GraphicsSettings;
  /** Actor id of the local player, which is always drawn. */
  private localId = 0;
  private tmpVec = new THREE.Vector3();
  /** Supplied by the Renderer, which owns the terrain heightfield. */
  private waterTest: ((x: number, z: number, y: number) => boolean) | null = null;

  constructor(scene: THREE.Scene, settings: GraphicsSettings) {
    this.settings = settings;
    this.group.name = 'animals';
    scene.add(this.group);
  }

  setSettings(settings: GraphicsSettings): void {
    this.settings = settings;
  }

  setLocalActor(id: number): void {
    this.localId = id;
  }

  /** Give the renderer a way to ask whether a position is in water. */
  setWaterTest(test: (x: number, z: number, y: number) => boolean): void {
    this.waterTest = test;
  }

  /** The Object3D for an actor, if it is currently drawn. */
  getModelRoot(id: number): THREE.Object3D | null {
    return this.actors.get(id)?.model?.root ?? null;
  }

  /** Interpolated world position of an actor, for the camera and audio. */
  getPosition(id: number, out: THREE.Vector3): boolean {
    const actor = this.actors.get(id);
    if (!actor) return false;
    out.copy(actor.pos);
    return true;
  }

  /** Height of an actor's back, for placing fly swarms and markers. */
  getBodyHeight(id: number): number {
    const actor = this.actors.get(id);
    if (!actor) return 1;
    return Math.max(0.3, ANIMALS[actor.species].silhouette.height * 1.4);
  }

  /**
   * Ingest a snapshot.
   *
   * Positions are stored as interpolation targets rather than applied directly,
   * so a 10 Hz snapshot stream renders as smooth motion at any frame rate.
   */
  applySnapshot(actors: SnapshotActor[]): void {
    // Mark everything stale, then refresh what the snapshot mentions.
    for (const actor of this.actors.values()) actor.stale += 1;

    for (const s of actors) {
      let actor = this.actors.get(s.id);
      if (!actor) {
        actor = {
          id: s.id,
          species: s.species,
          model: null,
          detail: -1,
          pos: new THREE.Vector3(s.x, s.y, s.z),
          target: new THREE.Vector3(s.x, s.y, s.z),
          yaw: s.yaw,
          targetYaw: s.yaw,
          gait: s.gait,
          flags: s.flags,
          flies: s.flies,
          phase: Math.random() * Math.PI * 2,
          stale: 0,
          fade: 0,
          distance: 0,
          inWater: false,
        };
        this.actors.set(s.id, actor);
      }

      // A species change means the server reassigned this actor (new round);
      // drop the old model so the right one gets built.
      if (actor.species !== s.species) {
        this.release(actor);
        actor.species = s.species;
        actor.pos.set(s.x, s.y, s.z);
      }

      actor.target.set(s.x, s.y, s.z);
      actor.targetYaw = s.yaw;
      actor.gait = s.gait;
      actor.flags = s.flags;
      actor.flies = s.flies;
      actor.stale = 0;
    }

    // Remove anything that has not been mentioned for a few snapshots — it has
    // either died or moved out of interest range.
    for (const [id, actor] of this.actors) {
      if (actor.stale > 3) {
        this.release(actor);
        this.actors.delete(id);
      }
    }
  }

  /**
   * Advance interpolation and animation.
   *
   * `cameraPos` drives level of detail and the visible-animal budget.
   */
  update(dt: number, cameraPos: THREE.Vector3, time: number): void {
    // Sort by distance so the budget goes to the animals the player can see.
    const visible: RenderActor[] = [];
    for (const actor of this.actors.values()) {
      actor.distance = Math.hypot(
        actor.target.x - cameraPos.x,
        actor.target.z - cameraPos.z,
      );
      actor.inWater = this.waterTest
        ? this.waterTest(actor.target.x, actor.target.z, actor.target.y)
        : false;
      visible.push(actor);
    }
    visible.sort((a, b) => a.distance - b.distance);

    const maxVisible = this.settings.maxVisibleAnimals;
    const maxArticulated = this.settings.maxArticulatedAnimals;
    const viewDistance = this.settings.viewDistance;

    let shown = 0;
    let articulated = 0;

    for (const actor of visible) {
      const isLocal = actor.id === this.localId;
      const withinView = actor.distance < viewDistance;
      const budgetLeft = shown < maxVisible;

      if (!isLocal && (!withinView || !budgetLeft)) {
        // Out of budget or out of range: give the model back rather than
        // keeping an invisible object in the scene graph.
        this.release(actor);
        actor.fade = 0;
        continue;
      }

      // Pick a detail level. The local player and near animals get the full
      // articulated model; the rest get the cheap one.
      const wantsNear = isLocal || (articulated < maxArticulated && actor.distance < 55);
      const detail = wantsNear ? MODEL_DETAIL_NEAR : MODEL_DETAIL_FAR;
      if (wantsNear) articulated++;
      shown++;

      if (!actor.model || actor.detail !== detail) {
        this.release(actor);
        actor.model = this.acquire(actor.species, detail);
        actor.detail = detail;
        this.group.add(actor.model.root);
      }

      this.interpolate(actor, dt);
      this.animate(actor, dt, time);
    }
  }

  /** Smooth the render transform towards the authoritative one. */
  private interpolate(actor: RenderActor, dt: number): void {
    // Exponential smoothing, with a snap for large corrections (teleports,
    // respawns) so the animal does not visibly glide across the map.
    const d = this.tmpVec.copy(actor.target).sub(actor.pos).length();
    if (d > 12) {
      actor.pos.copy(actor.target);
    } else {
      const k = 1 - Math.exp(-14 * dt);
      actor.pos.lerp(actor.target, k);
    }

    // Shortest-arc yaw interpolation.
    let diff = (actor.targetYaw - actor.yaw) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    actor.yaw += diff * Math.min(1, dt * 12);

    actor.fade = Math.min(1, actor.fade + dt * 3);
  }

  /**
   * The animation itself.
   *
   * Everything here is a function of `gait`, `moveMode` and the flags — all of
   * which are in the snapshot for players and AI alike.
   */
  private animate(actor: RenderActor, dt: number, time: number): void {
    const model = actor.model;
    if (!model) return;

    const def = ANIMALS[actor.species];
    const plan = def.silhouette.bodyPlan;
    const root = model.root;

    root.position.copy(actor.pos);
    /*
     * Every model is built head-first along +X (see AnimalModels), and `yaw` is
     * atan2(dz, dx) — the same convention. A rotation of θ about Y sends +X to
     * (cos θ, -sin θ) in XZ, so matching the heading (cos yaw, sin yaw) requires
     * exactly θ = -yaw. Any offset here makes every animal in the game walk at
     * an angle to the way it is facing.
     */
    root.rotation.y = -actor.yaw;
    root.visible = true;

    const dead = (actor.flags & ActorFlags.Dead) !== 0;
    const eating = (actor.flags & ActorFlags.Eating) !== 0;
    const submerged = (actor.flags & ActorFlags.Submerged) !== 0;
    const alerted = (actor.flags & ActorFlags.Alerted) !== 0;
    const flinching = (actor.flags & ActorFlags.Flinching) !== 0;
    const curled = (actor.flags & ActorFlags.Curled) !== 0;
    const airborne = (actor.flags & ActorFlags.Airborne) !== 0;

    if (dead) {
      // Roll onto one side and stop animating. A carcass is a landmark, and a
      // very informative one.
      root.rotation.z = Math.PI * 0.42;
      root.position.y -= def.silhouette.height * 0.35;
      return;
    }
    root.rotation.z = 0;

    // Stride frequency scales with size: small animals patter, big ones plod.
    const strideRate = 9 / Math.max(0.35, def.silhouette.length * 0.85);
    actor.phase += actor.gait * strideRate * dt;

    const swing = Math.sin(actor.phase);
    const swing2 = Math.sin(actor.phase * 2);
    const moving = actor.gait > 0.04;

    // --- Idle breathing -------------------------------------------------
    // Present on every animal, always. This is the single most important
    // animation in the game: it is what makes a motionless player animal look
    // alive in the same way a motionless AI does.
    const breathe = Math.sin(time * 1.5 + actor.id * 0.7) * 0.012;

    // --- Body ------------------------------------------------------------
    if (model.body !== root) {
      const baseY = model.body.userData.baseY ?? model.body.position.y;
      model.body.userData.baseY = baseY;
      // Vertical bob on each footfall, plus breathing when still.
      const bob = moving ? Math.abs(swing) * def.silhouette.height * 0.06 * actor.gait : 0;
      model.body.position.y = baseY + bob + breathe;
      // Slight roll into the stride.
      model.body.rotation.z = moving ? swing * 0.05 * actor.gait : 0;
      // Lean forward when sprinting.
      model.body.rotation.x = -actor.gait * 0.12;
      if (curled) {
        // Armadillo ball: shrink and hide the limbs.
        model.body.scale.setScalar(lerp(model.body.scale.x, 0.72, dt * 6));
      } else {
        model.body.scale.setScalar(lerp(model.body.scale.x, 1, dt * 6));
      }
    }

    // --- Head ------------------------------------------------------------
    if (model.head !== root) {
      const baseY = model.head.userData.baseY ?? model.head.position.y;
      model.head.userData.baseY = baseY;
      if (eating) {
        // Nose to the ground, with a chewing nod.
        model.head.rotation.z = lerp(model.head.rotation.z, -0.85, dt * 5);
        model.head.position.y = baseY - def.silhouette.height * 0.28;
        model.head.rotation.x = Math.sin(time * 9) * 0.08;
      } else if (alerted) {
        // Head up, scanning. A readable, copyable "something is wrong" pose.
        model.head.rotation.z = lerp(model.head.rotation.z, 0.34, dt * 6);
        model.head.position.y = baseY + def.silhouette.height * 0.1;
        model.head.rotation.y = Math.sin(time * 2.2) * 0.4;
      } else {
        model.head.rotation.z = lerp(model.head.rotation.z, moving ? 0.05 : 0, dt * 4);
        model.head.position.y = lerp(model.head.position.y, baseY, dt * 4);
        // Idle looking-about, at a lazy pace.
        model.head.rotation.y = Math.sin(time * 0.6 + actor.id) * 0.25;
      }
      if (flinching) {
        // The "Easily Scared" twitch: a sharp, brief jerk. Subtle enough to
        // miss, distinctive enough to notice if you are watching for it.
        model.head.rotation.y += Math.sin(time * 40) * 0.3;
      }
    }

    // --- Legs ------------------------------------------------------------
    /*
     * A pendulum swing alone does not read as walking — it reads as a toy
     * rocking. Three things sell a gait: the leg swings fore/aft, it *lifts*
     * off the ground during the forward half of the stride, and the whole body
     * rises slightly as each diagonal pair pushes off. All three are driven from
     * the same phase so they stay in sync at any speed.
     */
    if (model.legs.length > 0) {
      const swimming = actor.inWater;
      const amplitude = (swimming ? 0.5 : 0.75) * Math.max(actor.gait, swimming ? 0.35 : 0);
      for (let i = 0; i < model.legs.length; i++) {
        const leg = model.legs[i];
        if (curled) {
          leg.visible = false;
          continue;
        }
        leg.visible = true;

        const baseY = leg.userData.baseY ?? leg.position.y;
        leg.userData.baseY = baseY;

        if (airborne) {
          // Tucked in mid-jump.
          leg.rotation.z = lerp(leg.rotation.z, -0.55, dt * 10);
          leg.position.y = baseY;
          continue;
        }
        if (!moving && !swimming) {
          leg.rotation.z = lerp(leg.rotation.z, 0, dt * 6);
          leg.position.y = lerp(leg.position.y, baseY, dt * 6);
          continue;
        }

        // Diagonal gait: front-left moves with back-right.
        const diagonal = i === 0 || i === 3 ? 1 : -1;
        const legPhase = actor.phase * (swimming ? 1.5 : 1) + (diagonal > 0 ? 0 : Math.PI);
        const swing = Math.sin(legPhase);

        leg.rotation.z = swing * amplitude;
        // Lift only while the leg travels forward, so the other half of the
        // cycle plants it — that asymmetry is what makes it look like walking.
        const lift = Math.max(0, Math.cos(legPhase));
        leg.position.y = baseY + lift * def.silhouette.height * 0.14 * actor.gait;
      }
    }

    // --- Tail ------------------------------------------------------------
    for (let i = 0; i < model.tail.length; i++) {
      const seg = model.tail[i];
      const base = seg.userData.baseRotZ ?? seg.rotation.z;
      seg.userData.baseRotZ = base;
      // A travelling wave down the tail: later segments lag behind.
      const lag = i * 0.6;
      const sway = Math.sin(time * (moving ? 5 : 1.6) - lag) * (moving ? 0.16 : 0.07);
      seg.rotation.y = sway;
      seg.rotation.z = base + (moving ? swing2 * 0.05 : 0);
    }

    // --- Wings -----------------------------------------------------------
    for (let i = 0; i < model.wings.length; i++) {
      const wing = model.wings[i];
      const side = i === 0 ? 1 : -1;
      if (airborne) {
        // Flapping. Fast for small birds, slow and deliberate for an eagle.
        const flapRate = plan === BodyPlan.Insect ? 26 : 9 / Math.max(0.4, def.silhouette.length);
        wing.rotation.x = Math.sin(time * flapRate) * 0.9 * side;
      } else {
        wing.rotation.x = lerp(wing.rotation.x, 0.1 * side, dt * 5);
      }
    }

    // --- Serpents --------------------------------------------------------
    if (model.segments.length > 0) {
      const waveSpeed = moving ? 5.5 : 1.1;
      const waveAmp = moving ? 0.34 : 0.1;
      for (let i = 0; i < model.segments.length; i++) {
        const seg = model.segments[i];
        // The classic lateral undulation: a sine wave travelling tail-wards.
        seg.rotation.y = Math.sin(time * waveSpeed - i * 0.65) * waveAmp;
      }
    }

    // --- Swimming --------------------------------------------------------
    /*
     * Swimming needs its own motion, because the walk cycle looks absurd in
     * water. An animal in a river sways its whole body side to side, rolls
     * slightly with each stroke, and bobs on the surface — and crucially it
     * keeps moving even when barely making headway, which is why the leg
     * amplitude above has a floor while swimming.
     */
    if (actor.inWater) {
      const stroke = time * 2.6 + actor.id * 0.9;
      // Yaw sway: the body fishtails around its heading.
      root.rotation.y += Math.sin(stroke) * 0.09 * (0.4 + actor.gait);
      // Roll into each stroke.
      root.rotation.z = Math.sin(stroke + 0.7) * 0.07;
      // Bob on the surface, independent of the wave the water shader draws.
      root.position.y += Math.sin(stroke * 0.8) * 0.05;
      if (model.body !== root) {
        // Nose up slightly, the way a swimming animal holds its head clear.
        model.body.rotation.x = lerp(model.body.rotation.x, -0.12, dt * 4);
      }
    }

    if (submerged) {
      // Sink until only the top of the head shows. A submerged caiman is
      // supposed to be almost indistinguishable from a floating log.
      root.position.y -= def.silhouette.height * 0.55;
    }

    // --- Fade in --------------------------------------------------------
    if (actor.fade < 1) {
      const s = 0.7 + actor.fade * 0.3;
      root.scale.setScalar(s);
    } else if (root.scale.x !== 1) {
      root.scale.setScalar(1);
    }
  }

  // -------------------------------------------------------------------------
  // Pooling
  // -------------------------------------------------------------------------

  private poolKey(species: Species, detail: number): string {
    return `${species}:${detail}`;
  }

  private acquire(species: Species, detail: number): AnimalModel {
    const key = this.poolKey(species, detail);
    const list = this.pool.get(key);
    if (list && list.length > 0) {
      const model = list.pop()!;
      model.root.visible = true;
      return model;
    }
    return buildAnimalModel(species, detail);
  }

  private release(actor: RenderActor): void {
    if (!actor.model) return;
    const model = actor.model;
    model.root.visible = false;
    this.group.remove(model.root);
    const key = this.poolKey(actor.species, actor.detail);
    let list = this.pool.get(key);
    if (!list) {
      list = [];
      this.pool.set(key, list);
    }
    // Bound the pool: a species that briefly spiked to 40 instances should not
    // keep 40 models alive for the rest of the session.
    if (list.length < 48) list.push(model);
    actor.model = null;
    actor.detail = -1;
  }

  /**
   * Actors standing or swimming in water, for the ripple effect.
   *
   * Reported with their speed so the effects renderer can spawn ripples in
   * proportion to how hard they are churning the surface — a drifting caiman
   * barely disturbs it, a fleeing capybara throws a wake.
   */
  collectWaterWakes(out: { x: number; z: number; speed: number; radius: number }[]): void {
    out.length = 0;
    for (const actor of this.actors.values()) {
      if (!actor.inWater || !actor.model) continue;
      out.push({
        x: actor.pos.x,
        z: actor.pos.z,
        speed: actor.gait,
        radius: Math.max(0.35, ANIMALS[actor.species].silhouette.width * 1.5),
      });
    }
  }

  /** Actors that currently have visible flies, for the effects renderer. */
  collectFlySwarms(out: { pos: THREE.Vector3; intensity: number; height: number }[]): void {
    out.length = 0;
    for (const actor of this.actors.values()) {
      if (actor.flies <= 0.02 || !actor.model) continue;
      out.push({
        pos: actor.pos,
        intensity: clamp01(actor.flies),
        height: ANIMALS[actor.species].silhouette.height * 1.6 + 0.3,
      });
    }
  }

  /** Number of animals currently drawn, for the debug overlay. */
  get drawnCount(): number {
    let n = 0;
    for (const a of this.actors.values()) if (a.model) n++;
    return n;
  }

  get trackedCount(): number {
    return this.actors.size;
  }

  /** Drop everything (round change, teardown). */
  clear(): void {
    for (const actor of this.actors.values()) this.release(actor);
    this.actors.clear();
  }

  dispose(): void {
    this.clear();
    this.pool.clear();
    this.group.removeFromParent();
  }
}
