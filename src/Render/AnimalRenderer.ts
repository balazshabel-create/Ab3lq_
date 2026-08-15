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
  /**
   * Smoothed terrain pitch, in radians. Positive = nose up.
   *
   * Smoothed rather than sampled fresh each frame because an animal walking over
   * a rock gets a step change in the gradient, and snapping to it makes the whole
   * body flick. A short filter turns that into a lean.
   */
  slopePitch: number;
  /** Jaw opening, 0 = shut, 1 = wide. Smoothed so bites do not snap. */
  jawOpen: number;
  /** Bite animation timer, counts down from BITE_DURATION. */
  biteTimer: number;
  /** Attacking flag as of the previous snapshot, to catch the rising edge. */
  wasAttacking: boolean;
  /** In-water state last frame, so entering the water can be detected. */
  wasInWater: boolean;
  /**
   * Seconds since this actor died, or 0 while it is alive.
   *
   * A death needs a *timeline*, not a pose. Snapping straight to "lying on its
   * side" told the player something had happened somewhere off screen; a collapse
   * they can watch is the single most readable event in the game, because it also
   * tells them roughly when and which way the animal was facing.
   */
  deathTime: number;
  /**
   * How far a gorilla has risen onto its hind legs, 0..1.
   *
   * Smoothed here rather than sent over the wire: it is derived entirely from
   * flags a player animal and an AI animal both carry, so both rear up under
   * identical conditions and the display costs nothing on the network.
   */
  rearAmount: number;
}

const MODEL_DETAIL_NEAR = 1;
const MODEL_DETAIL_FAR = 0.3;

/**
 * How long one bite takes to play out, in seconds.
 *
 * Shorter than the attack cooldown on purpose: the animation is the *strike*,
 * and the rest of the cooldown is the animal recovering, which reads better as
 * ordinary movement than as a held pose.
 */
const BITE_DURATION = 0.42;

/**
 * Ceiling on how far terrain-following will pitch a body, in radians.
 *
 * A heightfield can be near-vertical at a cliff edge, and without a clamp an
 * animal that walks up to one stands on its nose. 32° is steeper than anything
 * the movement solver actually lets an animal walk up.
 */
const MAX_SLOPE_PITCH = 0.56;

export class AnimalRenderer {
  private group = new THREE.Group();
  private actors = new Map<number, RenderActor>();
  /** Free models, keyed by `species:detail`. */
  private pool = new Map<string, AnimalModel[]>();
  private settings: GraphicsSettings;
  /** Actor id of the local player, which is always drawn. */
  private localId = 0;
  /**
   * Suppress the local player's own body.
   *
   * Set while the camera is inside their head. Without it the first-person view
   * is filled by the inside of the hunter's own skull — which is not a subtle
   * artefact, it is an opaque wall two centimetres from the near plane.
   */
  private hideLocal = false;
  private tmpVec = new THREE.Vector3();
  /** Supplied by the Renderer, which owns the terrain heightfield. */
  private waterTest: ((x: number, z: number, y: number) => boolean) | null = null;
  /** Ground height lookup, for pitching bodies to the slope they stand on. */
  private groundAt: ((x: number, z: number) => number) | null = null;

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

  /** Hide (or show) the local player's own model. */
  setHideLocal(hide: boolean): void {
    this.hideLocal = hide;
  }

  /** Give the renderer a way to ask whether a position is in water. */
  setWaterTest(test: (x: number, z: number, y: number) => boolean): void {
    this.waterTest = test;
  }

  /** Give the renderer a ground-height lookup, for terrain-following bodies. */
  setGroundSampler(sample: (x: number, z: number) => number): void {
    this.groundAt = sample;
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

  /**
   * Is this actor under the surface?
   *
   * Read by the camera rig, which has to stop treating the water line as a floor
   * when the animal it is following goes below it — otherwise a submerged
   * crocodile is filmed from above the water and never gets the underwater view.
   */
  isSubmerged(id: number): boolean {
    const actor = this.actors.get(id);
    return actor ? (actor.flags & ActorFlags.Submerged) !== 0 : false;
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
          rearAmount: 0,
          inWater: false,
          slopePitch: 0,
          jawOpen: 0,
          biteTimer: 0,
          wasAttacking: false,
          wasInWater: false,
          deathTime: 0,
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

      /*
       * Latch a bite on the rising edge of the Attacking flag.
       *
       * The flag is only set for a fraction of a second on the server, and
       * snapshots arrive at 10 Hz — reading the flag directly would mean the
       * animation plays for however long the flag happened to be visible, and
       * would be missed entirely whenever the strike fell between two snapshots.
       * Latching a fixed-length timer instead means every bite is drawn in full.
       */
      const attacking = (s.flags & ActorFlags.Attacking) !== 0;
      if (attacking && !actor.wasAttacking) actor.biteTimer = BITE_DURATION;
      actor.wasAttacking = attacking;
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
      if (isLocal && this.hideLocal) {
        this.release(actor);
        actor.fade = 0;
        continue;
      }
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
     *
     * The same convention fixes what the other two axes mean, and it is not the
     * intuitive one. With the body lying along X and Y up, the lateral axis is Z
     * — so **pitch (nose up/down) is a rotation about Z, and roll (tipping
     * sideways) is a rotation about X**, which is the opposite of what you would
     * write for a model facing -Z. Euler order is the default XYZ, meaning the
     * matrix is Rx·Ry·Rz and the Z term is applied first, in the model's own
     * frame, before the yaw turns it — exactly what a body-relative pitch needs.
     *
     * Both of these were previously the wrong way round here, so "lean forward
     * when sprinting" rolled animals onto their side and the death pose stood
     * them on their nose.
     */
    root.rotation.y = -actor.yaw;
    root.visible = true;

    const dead = (actor.flags & ActorFlags.Dead) !== 0;
    const eating = (actor.flags & ActorFlags.Eating) !== 0;
    const alerted = (actor.flags & ActorFlags.Alerted) !== 0;
    const flinching = (actor.flags & ActorFlags.Flinching) !== 0;
    const curled = (actor.flags & ActorFlags.Curled) !== 0;
    const airborne = (actor.flags & ActorFlags.Airborne) !== 0;

    if (dead) {
      this.animateDeath(actor, model, def, dt);
      return;
    }
    actor.deathTime = 0;

    /*
     * ---- Follow the ground -----------------------------------------------
     *
     * The server sends one position, and its Y is the ground under the animal's
     * *centre*. Drawing a level body there is fine for a frog and wrong for a
     * four-metre caiman: walking uphill, the ground under its head is a metre
     * higher than under its middle, so the front of the animal is buried in the
     * hillside — which is exactly the tail-and-snout clipping this fixes.
     *
     * So sample the ground under each end, pitch the body to the line between
     * them, and then lift the whole animal so the *lower* end still clears the
     * surface. Two extra heightfield samples per drawn animal, and only for the
     * ones actually standing on ground.
     */
    let pitch = 0;
    let roll = 0;
    /*
     * The hunter is exempt from all of it.
     *
     * Terrain-following pitch is a quadruped idea: it exists because a long,
     * low body has to lie *along* the slope it is standing on. A person does
     * not — a person's feet follow the hill and their spine stays vertical, and
     * a man tilted 30° back because he is walking up a bank reads as a bug
     * immediately. His body is also only half a metre long, so the sampling
     * reach would be a quarter of a metre and the measured slope would be pure
     * noise even where the terrain is smooth.
     */
    const upright = def.silhouette.bodyPlan === BodyPlan.Human;
    const onGround = !upright && !actor.inWater && !airborne && this.groundAt !== null;
    if (onGround) {
      const reach = Math.max(0.25, def.silhouette.length * 0.42);
      const fx = Math.cos(actor.yaw);
      const fz = Math.sin(actor.yaw);
      const front = this.groundAt!(actor.pos.x + fx * reach, actor.pos.z + fz * reach);
      const back = this.groundAt!(actor.pos.x - fx * reach, actor.pos.z - fz * reach);
      const target = Math.atan2(front - back, reach * 2);
      const clamped = Math.max(-MAX_SLOPE_PITCH, Math.min(MAX_SLOPE_PITCH, target));
      actor.slopePitch += (clamped - actor.slopePitch) * Math.min(1, dt * 9);
      pitch += actor.slopePitch;

      /*
       * Clearance: with the body pitched, its ends sit at ±reach·sin(pitch)
       * relative to the centre. Raise the root by whatever the deeper end is
       * short by, so nothing dips below the surface it is standing on.
       *
       * ## The cap, which is the whole point
       *
       * Without it this launched animals into the air, and the place it happened
       * was the riverbank — walk up to the reeds at the water's edge and your
       * animal would rise several metres and hang there with its legs dangling.
       *
       * The mechanism: `front` is the ground one body-length ahead, and at the
       * foot of a steep bank that is metres above the animal. The pitch is
       * clamped to 32°, so the body stays roughly level while `front` runs away
       * upwards, and the uncapped deficit lifted the animal by the entire height
       * of the bank. Deepening the river made the banks steeper and turned an
       * occasional oddity into something you could reproduce on purpose.
       *
       * The fix is to bound the correction by what it is *for*. The only dip this
       * needs to cancel is the geometric one the pitch itself introduces, which
       * can never exceed reach·sin(maxPitch). Anything beyond that is not a
       * pitched body sinking into a slope, it is a wall — and the right answer at
       * a wall is to clip a little, not to levitate. The movement solver already
       * refuses to walk up anything that steep, so the animal is not going there
       * anyway.
       */
      const rise = Math.sin(actor.slopePitch) * reach;
      const frontGap = actor.pos.y + rise - front;
      const backGap = actor.pos.y - rise - back;
      const maxLift = reach * Math.sin(MAX_SLOPE_PITCH);
      const deficit = Math.min(maxLift, Math.max(0, -Math.min(frontGap, backGap)));
      root.position.y += deficit;
    } else {
      actor.slopePitch += (0 - actor.slopePitch) * Math.min(1, dt * 6);
    }

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
      // Roll into the stride — about X, the lateral axis. See the note above.
      model.body.rotation.x = moving ? swing * 0.05 * actor.gait : 0;
      // Lean forward when sprinting: nose down is a negative pitch about Z.
      // A running man leans into it too, but from the hips and much less far.
      model.body.rotation.z = -actor.gait * (upright ? 0.05 : 0.12);
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

    /*
     * --- The bite ---------------------------------------------------------
     *
     * Three phases in under half a second: rear back with the mouth opening,
     * snap the head forward as the jaw shuts, then recover. The whole animal
     * lunges, not just the head — a bite that only moves the jaw reads as an
     * animal yawning at its prey.
     *
     * This is also the only feedback a player gets that their attack happened at
     * all, so it has to be legible from behind, which is where the camera is.
     */
    if (actor.biteTimer > 0) {
      actor.biteTimer = Math.max(0, actor.biteTimer - dt);
      const t = 1 - actor.biteTimer / BITE_DURATION; // 0 → 1 over the strike
      // Windup for the first 35%, strike to 60%, recovery after.
      const windup = clamp01(t / 0.35);
      const strike = clamp01((t - 0.35) / 0.25);
      const recover = clamp01((t - 0.6) / 0.4);
      if (upright) {
        /*
         * The rifle, which is the opposite shape of a bite.
         *
         * A bite is a commitment forward; a shot is a shove backwards. So the
         * hunter settles for the windup, the muzzle climbs and the whole man
         * rocks back on his heels at the instant of firing, and he then walks
         * the sights down again — which is the part that makes it read as recoil
         * rather than as a flinch, because it takes longer than the kick did.
         */
        const kick = strike * (1 - recover);
        pitch += windup * -0.03 + kick * 0.2;
        root.position.x -= Math.cos(actor.yaw) * kick * 0.09;
        root.position.z -= Math.sin(actor.yaw) * kick * 0.09;
        if (model.muzzle) {
          // Two or three frames only. A flash you can watch is a flash that
          // reads as a lamp.
          model.muzzle.visible = t < 0.5 && t > 0.28;
          const s = 0.7 + Math.sin(t * 40) * 0.3;
          model.muzzle.scale.setScalar(s);
        }
      } else {
        // Open on the windup, slam shut on the strike.
        actor.jawOpen = Math.max(actor.jawOpen, windup * (1 - strike));
        // Pull back, then throw the whole body forward.
        const lunge = -windup * 0.12 + strike * 0.3 - recover * 0.3;
        pitch += -windup * 0.18 + strike * 0.26 - recover * 0.08;
        root.position.x += Math.cos(actor.yaw) * lunge;
        root.position.z += Math.sin(actor.yaw) * lunge;
      }
    } else if (model.muzzle && model.muzzle.visible) {
      model.muzzle.visible = false;
    }

    // --- Jaw -------------------------------------------------------------
    if (model.jaw) {
      if (eating) {
        // Chewing: a steady champ, faster than the head's nod so the two do not
        // beat against each other into one slow bob.
        actor.jawOpen = 0.35 + Math.sin(time * 11 + actor.id) * 0.3;
      } else if (actor.biteTimer <= 0) {
        // Relax shut. Panting when hard-run keeps a sprinting animal from
        // looking like it is holding its breath.
        const pant = actor.gait > 0.75 ? 0.22 + Math.sin(time * 7.5) * 0.12 : 0;
        actor.jawOpen += (pant - actor.jawOpen) * Math.min(1, dt * 8);
      }
      // Negative Z opens a jaw downwards — see addJaw.
      model.jaw.rotation.z = -clamp01(actor.jawOpen) * 0.55;
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
        const knee = model.knees[i];
        if (curled) {
          leg.visible = false;
          continue;
        }
        leg.visible = true;

        const baseY = leg.userData.baseY ?? leg.position.y;
        leg.userData.baseY = baseY;
        /*
         * Which way this knee folds. Forelegs bend backwards, hind legs
         * forwards, and `addJointedLeg` recorded that when it built the leg —
         * the animator must not re-derive it from the index, because not every
         * plan orders its limbs the same way (a primate's front pair are arms).
         */
        const fold = (knee?.userData.fold as number | undefined) ?? -1;

        if (airborne) {
          // Tucked in mid-jump: hips forward, knees folded hard.
          leg.rotation.z = lerp(leg.rotation.z, -0.55, dt * 10);
          if (knee) knee.rotation.z = lerp(knee.rotation.z, fold * 0.9, dt * 10);
          leg.position.y = baseY;
          continue;
        }
        if (!moving && !swimming) {
          leg.rotation.z = lerp(leg.rotation.z, 0, dt * 6);
          // Standing legs keep a slight bend. Locked straight reads as a
          // trestle rather than as an animal at rest.
          if (knee) knee.rotation.z = lerp(knee.rotation.z, fold * 0.16, dt * 6);
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

        /*
         * The knee, a quarter-cycle behind the hip.
         *
         * That lag is the whole trick. In phase, the leg scissors open and shut
         * like a compass and still reads as rigid; a quarter cycle late, the
         * shank tucks under exactly while the foot is off the ground and swings
         * through to straighten just as it plants. Held at a small positive bend
         * throughout so it never hyperextends backwards through the joint.
         */
        if (knee) {
          const tuck = (Math.sin(legPhase - Math.PI * 0.5) * 0.5 + 0.5) * amplitude * 0.9;
          knee.rotation.z = fold * (0.12 + tuck);
        }
      }
    }

    // --- Tail ------------------------------------------------------------
    /*
     * A crocodile's tail is not a decoration that follows the body — it is what
     * the animal *swims with*, and it sculls in slow, heavy sweeps that carry
     * far more amplitude than a cat's flick. Giving every plan the same small
     * wave made a four-metre caiman look like it had a piece of rope attached.
     */
    const scull = plan === BodyPlan.Reptile;
    const tailRate = scull ? (actor.inWater ? 2.4 : 1.5) : moving ? 5 : 1.6;
    const tailAmp = scull
      ? (actor.inWater ? 0.5 : 0.12) * (0.45 + actor.gait)
      : moving
        ? 0.16
        : 0.07;
    for (let i = 0; i < model.tail.length; i++) {
      const seg = model.tail[i];
      const base = seg.userData.baseRotZ ?? seg.rotation.z;
      seg.userData.baseRotZ = base;
      // A travelling wave down the tail: later segments lag behind. The lag is
      // the whole illusion — in phase, a tail is a rigid stick that pivots.
      const lag = i * (scull ? 0.5 : 0.6);
      seg.rotation.y = Math.sin(time * tailRate - lag) * tailAmp;
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

    /*
     * --- The gorilla stands up --------------------------------------------
     *
     * A silverback that has decided you are a problem rises onto its hind legs,
     * and it is the most legible threat display any animal in this game makes:
     * it doubles in height in about a third of a second, from across a clearing,
     * with no sound needed.
     *
     * Driven off the states the animal is already in — alert, or mid-strike — so
     * it costs no new network field and an AI gorilla and a player gorilla rear
     * up under exactly the same conditions. The pose is a pitch about Z (nose
     * up, the same axis as every other body-relative pitch here) plus a lift, so
     * the hind feet stay on the ground while the chest comes off it.
     */
    if (def.species === Species.Gorilla) {
      const wants = alerted || actor.biteTimer > 0 ? 1 : 0;
      // Rises fast, settles slowly. A display that faded at the same rate it
      // arrived would read as a wobble rather than as a decision.
      const rate = wants > actor.rearAmount ? 7 : 2.2;
      actor.rearAmount += (wants - actor.rearAmount) * Math.min(1, dt * rate);
      if (actor.rearAmount > 0.001) {
        const rear = actor.rearAmount;
        pitch += rear * 0.95;
        root.position.y += rear * def.silhouette.height * 0.42;
        if (model.body !== root) {
          // The arms come up and out with the chest.
          for (let i = 0; i < 2 && i < model.legs.length; i++) {
            model.legs[i].rotation.z -= rear * 0.7;
            const knee = model.knees[i];
            if (knee) knee.rotation.z += rear * 0.5;
          }
        }
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
      // Roll into each stroke — about X, the lateral axis.
      roll += Math.sin(stroke + 0.7) * 0.07;
      // Bob on the surface, independent of the wave the water shader draws.
      root.position.y += Math.sin(stroke * 0.8) * 0.05;
      if (model.body !== root) {
        // Nose up slightly, the way a swimming animal holds its head clear.
        model.body.rotation.z = lerp(model.body.rotation.z, 0.12, dt * 4);
      }
    }

    /*
     * Submerged animals need no vertical offset here.
     *
     * The movement solver already puts a submerged body down on the river bed —
     * see the `submerging` branch in Locomotion — so the snapshot's Y is already
     * the right depth. Subtracting another half body height on top of that, which
     * is what this used to do when submerging only sank an animal a fixed amount
     * below the surface, now pushes it through the bed and out of sight.
     */

    // --- Commit the body orientation --------------------------------------
    // Assigned once, at the end, so the slope, the bite lunge and the swimming
    // roll add up instead of each overwriting the last one's axis.
    root.rotation.z = pitch;
    root.rotation.x = roll;

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

  /**
   * The death animation.
   *
   * ## Why this is a timeline and not a pose
   *
   * It used to be three lines: set the roll to 76°, drop the body, return. That
   * is a *carcass*, and a carcass is fine — but the moment of dying is the single
   * most informative event in this game. A player who sees an animal go down
   * learns that something killed it, roughly where, and which way it was facing
   * when it happened. A snap to the final pose throws all of that away, and reads
   * as the animal being deleted and replaced by a prop.
   *
   * Four stages, driven off `deathTime`:
   *
   *  1. **Buckle** (0 – 0.28 s). The legs give out and the body sinks straight
   *     down while the head goes back. Nothing rotates yet, because a real
   *     collapse starts with the legs failing, not with the body tipping.
   *  2. **Topple** (0.28 – 1.0 s). The roll comes on with an ease-out and a small
   *     overshoot, so the body drops onto its side and rocks back rather than
   *     rotating at constant speed like a hinge.
   *  3. **Twitch** (1.0 – 1.7 s). One decaying spasm through the legs and tail.
   *     This is the stage that stops it looking like furniture, and it is cheap:
   *     a damped sine on joints that are already there.
   *  4. **Rest**. Everything limp and still, jaw slightly open.
   *
   * `deathTime` keeps counting past the end so a corpse that comes into view late
   * is already settled rather than starting its collapse the moment you look at
   * it — the animal did not wait for an audience.
   */
  private animateDeath(
    actor: RenderActor,
    model: AnimalModel,
    def: (typeof ANIMALS)[Species],
    dt: number,
  ): void {
    actor.deathTime += dt;
    const t = actor.deathTime;
    const root = model.root;
    const height = def.silhouette.height;

    // --- Stage 1: the legs buckle ----------------------------------------
    const buckle = clamp01(t / 0.28);
    // --- Stage 2: the topple ---------------------------------------------
    const rollT = clamp01((t - 0.28) / 0.72);
    // Ease-out with a decaying overshoot: lands, rocks back, settles.
    const eased = 1 - Math.pow(1 - rollT, 3);
    const overshoot = rollT < 1 ? Math.sin(rollT * Math.PI) * 0.12 * (1 - rollT) : 0;
    const roll = (Math.PI * 0.46 + overshoot) * eased;

    /*
     * Roll about X, which is the body's long axis.
     *
     * The models are built head-first along +X, so rotating about X lays the
     * animal on its flank. Getting this axis wrong stands the corpse on its nose,
     * which is exactly what an earlier version of this did.
     */
    root.rotation.x = roll;
    root.rotation.z = 0;
    // Sink as the legs fold, then a little further as it comes to rest on its side.
    root.position.y -= height * (0.18 * buckle + 0.2 * eased);

    // --- Stage 3: one decaying twitch ------------------------------------
    const twitch = t > 1.0 && t < 1.7 ? Math.sin((t - 1.0) * 22) * Math.exp(-(t - 1.0) * 4) : 0;

    // Legs: splay outward as they give, then go limp with a spasm through them.
    for (let i = 0; i < model.legs.length; i++) {
      const leg = model.legs[i];
      leg.visible = true;
      const dir = i % 2 === 0 ? 1 : -1;
      // Fold forward/back alternately, so the legs do not all point one way.
      leg.rotation.z = lerp(leg.rotation.z, dir * 0.5 * buckle + twitch * 0.5, Math.min(1, dt * 9));
      const knee = model.knees[i];
      if (knee) {
        const fold = (knee.userData.fold as number | undefined) ?? -1;
        // Curled up tight — a dead animal's legs are drawn in, not straight.
        knee.rotation.z = lerp(knee.rotation.z, fold * (1.1 * buckle + twitch * 0.3), Math.min(1, dt * 9));
      }
    }

    // Head: thrown back as it goes, then hanging.
    model.head.rotation.z = lerp(
      model.head.rotation.z,
      -0.5 * buckle + 0.25 * eased + twitch * 0.4,
      Math.min(1, dt * 7),
    );
    // Jaw falls open and stays there.
    if (model.jaw) {
      model.jaw.rotation.z = lerp(model.jaw.rotation.z, -0.3 * eased, Math.min(1, dt * 5));
    }

    // Tail and body segments: limp, with the twitch travelling down them.
    for (let i = 0; i < model.tail.length; i++) {
      const seg = model.tail[i];
      const lag = Math.exp(-i * 0.35);
      seg.rotation.y = lerp(seg.rotation.y, twitch * 0.7 * lag, Math.min(1, dt * 8));
      seg.rotation.z = lerp(seg.rotation.z, 0.12 * eased * lag, Math.min(1, dt * 8));
    }
    for (let i = 0; i < model.segments.length; i++) {
      const seg = model.segments[i];
      seg.rotation.y = lerp(seg.rotation.y, twitch * 0.5 * Math.exp(-i * 0.2), Math.min(1, dt * 8));
    }
    // Wings drop.
    for (const wing of model.wings) {
      wing.rotation.z = lerp(wing.rotation.z, -0.7 * eased, Math.min(1, dt * 6));
    }
  }

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
   * Animals that entered the water since the last call, for the splash effect.
   *
   * Detected here rather than from the server's `splashed` result because the
   * client already recomputes `inWater` every frame from the heightfield, and a
   * transition on that is exactly the event we want — including for animals whose
   * splash the server never told us about because they are not ours.
   */
  collectSplashes(out: { x: number; z: number; strength: number }[]): void {
    out.length = 0;
    for (const actor of this.actors.values()) {
      const entered = actor.inWater && !actor.wasInWater;
      actor.wasInWater = actor.inWater;
      if (!entered || !actor.model) continue;
      const def = ANIMALS[actor.species];
      out.push({
        x: actor.pos.x,
        z: actor.pos.z,
        // A tapir hitting the river throws far more water than a frog, and an
        // animal that ran in throws more than one that waded.
        strength: def.silhouette.width * def.silhouette.length * (0.5 + actor.gait),
      });
    }
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
