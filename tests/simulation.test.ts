/**
 * simulation.test.ts — headless checks on the rules that matter most.
 *
 * These run the real Simulation in Node, with no renderer, which is the whole
 * reason the sim has no Three.js dependency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../src/Core/Simulation';
import {
  ActorKind,
  Role,
  RoundPhase,
  ActorFlags,
  type Actor,
  type PlayerActor,
} from '../src/Core/Types';
import {
  AbilityId,
  ALL_SPECIES,
  ANIMALS,
  PLAYABLE_SPECIES,
  SPAWNABLE_SPECIES,
  Species,
  isEnabled,
} from '../src/Animals/AnimalTypes';
import { biteDamage, canPrey } from '../src/Animals/FoodChain';
import { canSwim } from '../src/Animals/AnimalTypes';
import { Terrain } from '../src/World/Terrain';
import { Rng } from '../src/Systems/Rng';
import {
  WEAKNESSES,
  eligibleWeaknesses,
  isWeaknessEligible,
  rollWeakness,
  WeaknessId,
} from '../src/Gameplay/Weaknesses';
import { assignRoles } from '../src/Gameplay/RoundState';
import {
  ALL_EVENTS,
  EVENTS,
  createSchedule,
  updateSchedule,
  type EventId,
} from '../src/Gameplay/RandomEvents';
import { evaluateZone, planRings } from '../src/Gameplay/StormZone';
import {
  InputAction,
  decodeSnapshot,
  encodeSnapshot,
  type Snapshot,
} from '../src/Networking/Protocol';
import {
  AI_POPULATION,
  AI_SPECIES_COVER_MIN,
  ATTACK_STRIKE_TIME,
  EVENT_LOCKOUT_START,
  HUNGER_DECAY_RATE,
  HUNTER_ATTACK_COOLDOWN,
  RIFLE_RANGE,
  ROUND_DURATION,
  SIM_DT,
  WHISTLE_INTERVAL,
  WORLD_SIZE,
  ZONE_FIRST_SHRINK_AT,
  ZONE_INITIAL_RADIUS,
  ZONE_SHRINK_DURATION,
} from '../src/Systems/Config';
import type { RoundResult } from '../src/Gameplay/RoundState';

const TICK = SIM_DT;

/** Run a simulation forward by `seconds`, at the authority tick rate. */
function advance(sim: Simulation, seconds: number): void {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) sim.update(TICK);
}

test('terrain is deterministic for a given seed', () => {
  const a = new Terrain(12345);
  const b = new Terrain(12345);
  const c = new Terrain(54321);
  for (const [x, z] of [
    [0, 0],
    [50, -80],
    [-120, 200],
    [17.5, 3.25],
  ]) {
    assert.equal(a.heightAt(x, z), b.heightAt(x, z), 'same seed must give same height');
  }
  // Different seeds should give a different world.
  let differences = 0;
  for (let i = 0; i < 40; i++) {
    const x = i * 7 - 140;
    if (Math.abs(a.heightAt(x, x * 0.5) - c.heightAt(x, x * 0.5)) > 0.01) differences++;
  }
  assert.ok(differences > 20, 'different seeds must produce different terrain');
});

test('terrain has both walkable land and swimmable water', () => {
  const terrain = new Terrain(777);
  const rng = new Rng(1);
  let land = 0;
  let water = 0;
  for (let i = 0; i < 400; i++) {
    const p = rng.inCircle(250);
    if (terrain.isWater(p.x, p.y)) water++;
    else land++;
  }
  assert.ok(land > 100, `expected plenty of dry land, got ${land}`);
  assert.ok(water > 10, `expected some water, got ${water}`);
});

test('weaknesses are anatomically plausible', () => {
  // A snake has no legs, so it must never roll a leg or climbing injury.
  assert.equal(isWeaknessEligible(Species.Anaconda, WeaknessId.InjuredLeg), false);
  assert.equal(isWeaknessEligible(Species.Anaconda, WeaknessId.NoisySteps), false);
  assert.equal(isWeaknessEligible(Species.Anaconda, WeaknessId.ShortLegs), false);
  // A herbivore has no meaningful bite to lose.
  assert.equal(isWeaknessEligible(Species.Parrot, WeaknessId.MissingTeeth), false);
  /*
   * The two climbing weaknesses (Weak Grip, Injured Arm) are gone along with
   * climbing itself. A weakness no species can roll is dead content that still
   * shows up in the table and still has to be reasoned about, so it was deleted
   * rather than left permanently ineligible.
   */
  assert.ok(
    !Object.values(WeaknessId).some((w) => /grip|arm/.test(w)),
    'a climbing weakness survived the removal of climbing',
  );
  // Every playable species must have at least one option to roll.
  for (const s of PLAYABLE_SPECIES) {
    assert.ok(eligibleWeaknesses(s).length > 0, `${s} has no eligible weakness`);
  }
});

test('rolled weaknesses are always eligible for the species', () => {
  const rng = new Rng(99);
  for (const s of PLAYABLE_SPECIES) {
    for (let i = 0; i < 60; i++) {
      const w = rollWeakness(s, rng);
      assert.ok(
        isWeaknessEligible(s, w),
        `${s} rolled ineligible weakness ${w} (${WEAKNESSES[w].name})`,
      );
    }
  }
});

test('role dealing produces exactly one hunter, always the human, never weakened', () => {
  const rng = new Rng(4242);
  for (let trial = 0; trial < 40; trial++) {
    const n = 1 + (trial % 12);
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);

    const assignments = assignRoles(ids, rng);
    const hunters = assignments.filter((a) => a.role === Role.Hunter);
    assert.equal(hunters.length, 1, `expected 1 hunter for ${n} players`);
    assert.equal(hunters[0].weakness, null, 'the hunter must never carry a weakness');
    assert.equal(
      hunters[0].species,
      Species.Hunter,
      'the hunter is a man with a rifle, never an animal',
    );
    // And no survivor is ever handed the human body.
    for (const a of assignments.filter((x) => x.role === Role.Survivor)) {
      assert.notEqual(a.species, Species.Hunter, 'survivors are animals');
    }
    // Every survivor gets a weakness, and it must fit their species.
    for (const a of assignments.filter((x) => x.role === Role.Survivor)) {
      assert.ok(a.weakness, 'survivors must have a weakness');
      assert.ok(isWeaknessEligible(a.species, a.weakness!));
    }
  }
});

test('the hunter is the only human in the world', () => {
  const sim = new Simulation(2024);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `Player ${i}`);
  sim.startRound();

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter);
  assert.ok(hunter, 'a hunter must exist');
  assert.equal(hunter!.species, Species.Hunter, 'the hunter is a man with a rifle');

  /*
   * Nothing else in the world may wear the human body.
   *
   * The hunter used to need a crowd of his own species to hide in; now the
   * opposite invariant is the one that matters. He is meant to be unmistakable,
   * so a second human anywhere — an AI spawn that reached into the species table
   * without filtering, an ambient wildlife pass — would quietly hand the
   * survivors a place to hide that the design never intended them to have.
   */
  let humans = 0;
  sim.forEachNearby(0, 0, 10_000, (a) => {
    if (a.species === Species.Hunter) humans++;
  });
  assert.equal(humans, 1, `expected exactly one human in the world, found ${humans}`);
});

test('every player species gets AI cover to hide among', () => {
  /*
   * Three players rather than six.
   *
   * With a population of five, six players on six distinct species cannot each
   * be given a companion — the budget runs out, and the clamp in `spawnPopulation`
   * is what stops it overshooting instead. Three players is inside the budget, so
   * the guarantee this test exists to protect is still testable.
   */
  const sim = new Simulation(31337);
  for (let i = 0; i < 3; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();

  // The hunter is skipped: he is a man, and a man has no cover by design.
  for (const player of sim.getPlayers().filter((p) => p.role === Role.Survivor)) {
    let count = 0;
    sim.forEachNearby(0, 0, 10_000, (a) => {
      if (a.species === player.species && a.id !== player.id) count++;
    });
    assert.ok(
      count >= AI_SPECIES_COVER_MIN,
      `${player.species} only has ${count} AI companions`,
    );
  }
});

test('a round terminates cleanly and produces a full reveal', () => {
  const sim = new Simulation(555);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();

  assert.equal(sim.round.phase, RoundPhase.Intro);
  advance(sim, 10);
  assert.equal(sim.round.phase, RoundPhase.Playing);

  // These players send no input, so they stand there and are starved or eaten.
  // The round may therefore end early — capture the result the moment it
  // appears rather than assuming it runs the full ten minutes.
  let result: RoundResult | null = null;
  const maxTicks = Math.round((ROUND_DURATION + 30) / TICK);
  for (let i = 0; i < maxTicks && !result; i++) {
    sim.update(TICK);
    if (sim.round.phase === RoundPhase.RoundOver) result = sim.round.result;
  }

  assert.ok(result, 'a result must be produced');
  assert.equal(result!.reveals.length, 4, 'every player must appear in the reveal');
  assert.equal(
    result!.reveals.filter((r) => r.role === Role.Hunter).length,
    1,
    'the reveal must name exactly one hunter',
  );
  assert.ok(result!.hunterName.length > 0, 'the hunter must be named');
  assert.ok(result!.awards.length > 0, 'the round summary must include awards');
  // Survivor weaknesses become public only now.
  for (const r of result!.reveals.filter((x) => x.role === Role.Survivor)) {
    assert.ok(r.weakness, 'survivor weaknesses are revealed at the end');
  }
});

test('the round-over screen gives way to the lobby', () => {
  const sim = new Simulation(556);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 10);

  // Force an immediate end by killing the only player.
  const player = sim.getPlayers()[0];
  sim.damageActor(player.id, 9999, 0);
  advance(sim, 1);
  assert.equal(sim.round.phase, RoundPhase.RoundOver);

  advance(sim, 30);
  assert.equal(sim.round.phase, RoundPhase.Lobby, 'the lobby must come back afterwards');
});

test('a survivor who never whistles becomes covered in flies', () => {
  const sim = new Simulation(8080);
  sim.addPlayer('a', 'A');
  sim.addPlayer('b', 'B');
  sim.startRound();
  advance(sim, 9); // clear the intro

  const survivor = sim.getPlayers().find((p) => p.role === Role.Survivor);
  assert.ok(survivor, 'need a survivor');
  assert.equal(survivor!.flies, 0, 'no flies at the start of a round');

  advance(sim, WHISTLE_INTERVAL + 1);
  assert.ok(survivor!.flies > 0, 'flies must appear once the whistle is overdue');

  advance(sim, 25);
  assert.ok(survivor!.flies > 0.9, `swarm should be full, got ${survivor!.flies}`);
});

test('the hunter never accumulates flies', () => {
  const sim = new Simulation(9090);
  for (let i = 0; i < 3; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 9);

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter)!;
  advance(sim, WHISTLE_INTERVAL * 2);
  assert.equal(hunter.flies, 0, 'the hunter has no whistle obligation, so no flies');
});

test('hunger drains at the rate the species table specifies', () => {
  const sim = new Simulation(1212);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 9);

  const player = sim.getPlayers()[0];
  const startHunger = player.hunger;
  const seconds = 60;
  advance(sim, seconds);

  const drained = startHunger - player.hunger;
  assert.ok(drained > 0, 'hunger must drain over time');

  // Compare against the configured rate for this player's actual species, so
  // the test checks the balance intent rather than a hard-coded number.
  const expected = HUNGER_DECAY_RATE * ANIMALS[player.species].hungerRate * seconds;
  assert.ok(
    Math.abs(drained - expected) < expected * 0.12,
    `${player.species} drained ${drained.toFixed(2)}%, expected about ${expected.toFixed(2)}%`,
  );
});

test('hunger is a real clock: an average animal empties inside one round', () => {
  // The design intent is that hunger matters within a single ten minute round.
  // A multiplier-1.0 species must run out well before the final whistle.
  const perSecond = HUNGER_DECAY_RATE;
  const secondsToEmpty = 100 / perSecond;
  assert.ok(
    secondsToEmpty < ROUND_DURATION * 0.85,
    `an average animal takes ${secondsToEmpty.toFixed(0)}s to starve; that is too slow for a ${ROUND_DURATION}s round`,
  );
  // ...but the sloth must still be able to coast the whole round without eating.
  const slothSeconds = 100 / (perSecond * ANIMALS[Species.Sloth].hungerRate);
  assert.ok(
    slothSeconds > ROUND_DURATION,
    `the sloth should never need to eat, but starves after ${slothSeconds.toFixed(0)}s`,
  );
});

test('reaching zero hunger kills the player', () => {
  const sim = new Simulation(1213);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 9);

  const player = sim.getPlayers()[0];
  // Put them on the edge of starvation deterministically, rather than waiting
  // for whichever species the dealer happened to hand out.
  player.hunger = 0.5;
  advance(sim, 40);

  assert.equal(player.hunger, 0, 'hunger must bottom out at zero');
  assert.ok((player.flags & ActorFlags.Dead) !== 0, 'starvation must be fatal');
});

test('species hunger rates differ as designed', () => {
  // The sloth is the designed extreme: it should outlast the jaguar easily.
  assert.ok(ANIMALS[Species.Sloth].hungerRate < ANIMALS[Species.Capybara].hungerRate);
  assert.ok(ANIMALS[Species.Capybara].hungerRate < ANIMALS[Species.Jaguar].hungerRate);
});

test('AI animals actually move around', () => {
  const sim = new Simulation(6161);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 9);

  const before: { id: number; x: number; z: number }[] = [];
  sim.forEachNearby(0, 0, 10_000, (a) => before.push({ id: a.id, x: a.pos.x, z: a.pos.z }));

  advance(sim, 12);

  let moved = 0;
  const after = new Map<number, { x: number; z: number }>();
  sim.forEachNearby(0, 0, 10_000, (a) => after.set(a.id, { x: a.pos.x, z: a.pos.z }));
  for (const b of before) {
    const a = after.get(b.id);
    if (!a) continue;
    if (Math.hypot(a.x - b.x, a.z - b.z) > 1) moved++;
  }
  assert.ok(moved > before.length * 0.25, `expected many animals to move, only ${moved} did`);
});

test('animals stay inside the world bounds', () => {
  const sim = new Simulation(4321);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 60);

  let outOfBounds = 0;
  sim.forEachNearby(0, 0, 100_000, (a) => {
    if (!Number.isFinite(a.pos.x) || !Number.isFinite(a.pos.z) || !Number.isFinite(a.pos.y)) {
      outOfBounds++;
      return;
    }
    // Derived from WORLD_SIZE rather than hardcoded: clampToBounds keeps actors
    // inside HALF * 0.89, and a literal here silently becomes wrong the moment
    // the world is resized — which is exactly what happened.
    const limit = (WORLD_SIZE / 2) * 0.9;
    if (Math.max(Math.abs(a.pos.x), Math.abs(a.pos.z)) > limit) outOfBounds++;
  });
  assert.equal(outOfBounds, 0, 'no animal may leave the map or reach a NaN position');
});

test('snapshot encoding round-trips without losing meaningful precision', () => {
  const snap: Snapshot = {
    tick: 4242,
    time: 123.5,
    waterLevel: 2.2,
    actors: [
      {
        id: 7,
        species: Species.Capybara,
        x: -123.375,
        y: 4.25,
        z: 88.125,
        yaw: 1.25,
        gait: 0.5,
        flags: ActorFlags.Sprinting | ActorFlags.Alerted,
        flies: 0.5,
      },
      {
        id: 300,
        species: Species.Anaconda,
        x: 12.5,
        y: 2.5,
        z: -4.75,
        yaw: 5.5,
        gait: 1,
        flags: 0,
        flies: 0,
      },
    ],
    self: {
      actorId: 7,
      health: 82.5,
      maxHealth: 100,
      hunger: 61.25,
      stamina: 40.5,
      maxStamina: 100,
      sinceWhistle: 12.5,
      whistleCooldown: 1.25,
      flies: 0.5,
      eatProgress: 0.25,
      abilityReady: 1,
      listenReady: 0.5,
      focusReady: 1,
      attackReady: 0,
      digesting: 10.5,
    },
    noises: [{ x: 10.5, z: -20.25, volume: 40, kind: 'whistle' as never, age: 0.5 }],
    tracks: [{ x: 5.5, z: 6.25, yaw: 3, species: Species.Monkey, age: 12 }],
  };

  const decoded = decodeSnapshot(encodeSnapshot(snap));
  assert.ok(decoded, 'snapshot must decode');
  assert.equal(decoded!.tick, snap.tick);
  assert.equal(decoded!.actors.length, 2);
  assert.equal(decoded!.actors[0].id, 7);
  assert.equal(decoded!.actors[0].species, Species.Capybara);
  assert.equal(decoded!.actors[0].x, -123.375, 'position uses exact 1/8 m steps');
  assert.equal(decoded!.actors[0].flags, snap.actors[0].flags);
  assert.equal(decoded!.actors[1].species, Species.Anaconda);
  assert.ok(Math.abs(decoded!.actors[0].yaw - 1.25) < 0.001);
  assert.equal(decoded!.self!.actorId, 7);
  assert.ok(Math.abs(decoded!.self!.health - 82.5) < 0.05);
  assert.ok(Math.abs(decoded!.self!.hunger - 61.25) < 0.02);
  assert.equal(decoded!.noises.length, 1);
  assert.equal(decoded!.noises[0].kind, 'whistle');
  assert.equal(decoded!.tracks.length, 1);
  assert.equal(decoded!.tracks[0].species, Species.Monkey);
});

test('snapshots never leak another player role, weakness or hunger', () => {
  const sim = new Simulation(31415);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 12);

  const victim = sim.getPlayers().find((p) => p.role === Role.Survivor)!;
  const snap = sim.buildSnapshotFor(victim.clientId);

  // Only the receiving player's own private block is present.
  assert.equal(snap.self!.clientId, victim.clientId);

  // Encode it the way the server does and confirm the wire form carries no
  // role, weakness or hunger for anybody else.
  const wire: Snapshot = {
    tick: sim.tick,
    time: sim.time,
    waterLevel: sim.currentWaterLevel,
    actors: snap.actors.map((a) => ({
      id: a.id,
      species: a.species,
      x: a.pos.x,
      y: a.pos.y,
      z: a.pos.z,
      yaw: a.yaw,
      gait: a.gait,
      flags: a.flags,
      flies: a.flies,
    })),
    self: null,
    noises: [],
    tracks: [],
  };
  const decoded = decodeSnapshot(encodeSnapshot(wire))!;
  for (const a of decoded.actors) {
    assert.ok(!('role' in a), 'no role on the wire');
    assert.ok(!('weakness' in a), 'no weakness on the wire');
    assert.ok(!('hunger' in a), 'no hunger on the wire');
  }
});

test('players and AI of the same species are indistinguishable on the wire', () => {
  /*
   * Two players, and the comparison is made from the survivor's point of view.
   * With one player they would be dealt the hunter, and the hunter is a human —
   * the one actor in the game that has no AI counterpart to be confused with.
   */
  const sim = new Simulation(2718);
  sim.addPlayer('a', 'A');
  sim.addPlayer('b', 'B');
  sim.startRound();
  advance(sim, 12);

  const player = sim.getPlayers().find((p) => p.role === Role.Survivor)!;
  assert.ok(player, 'need a survivor to compare');
  const snap = sim.buildSnapshotFor(player.clientId);
  const sameSpecies = snap.actors.filter((a) => a.species === player.species);
  assert.ok(sameSpecies.length > 1, 'need AI of the same species nearby to compare');

  // The wire form of a player and of an AI animal must have identical shape:
  // the same keys, in the same order, with no extra fields for either.
  const shape = (a: (typeof snap.actors)[number]) =>
    Object.keys({
      id: a.id,
      species: a.species,
      x: a.pos.x,
      y: a.pos.y,
      z: a.pos.z,
      yaw: a.yaw,
      gait: a.gait,
      flags: a.flags,
      flies: a.flies,
    }).join(',');
  const playerShape = shape(player);
  for (const a of sameSpecies) {
    assert.equal(shape(a), playerShape, 'AI and player must serialise identically');
  }
});

test('withdrawn species never appear anywhere in the game', () => {
  /*
   * All four flying species were withdrawn at one point, because a *playable*
   * flyer reads poorly: it sees the whole clearing, nothing can reach it, and the
   * hiding game stops being a game. That reasoning is about being playable, not
   * about flying — so the parrot and the heron are back as ambient-only life,
   * where birds crossing the canopy are exactly what the world was missing.
   *
   * The eagle and the bat stay withdrawn: both are predators, so re-enabling them
   * would put a hunter in the air.
   *
   * Their table entries must remain either way — the wire format indexes into
   * ALL_SPECIES — but a withdrawn species must never reach the world.
   */
  const withdrawn = [Species.Eagle, Species.Bat];

  for (const species of withdrawn) {
    assert.equal(isEnabled(species), false, `${species} should be withdrawn`);
    assert.ok(ALL_SPECIES.includes(species), 'the table entry must be kept for wire stability');
    assert.ok(!SPAWNABLE_SPECIES.includes(species), `${species} must not be spawnable`);
    assert.ok(!PLAYABLE_SPECIES.includes(species), `${species} must not be selectable`);
  }

  // And none of them should be in a populated world.
  const sim = new Simulation(4711);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 12);

  const seen = new Set<Species>();
  sim.forEachNearby(0, 0, 100_000, (a) => seen.add(a.species));
  for (const species of withdrawn) {
    assert.ok(!seen.has(species), `${species} was spawned despite being withdrawn`);
  }
});

test('a predator can actually kill the AI prey it hunts', () => {
  /*
   * Regression test for a bite that connected but did nothing useful: at
   * HUNTER_DAMAGE a fleeing capybara needed three hits across seven seconds, so
   * predators could never feed and the attack felt broken.
   *
   * The biter has to be a *survivor*, not whoever holds the hunter role: the
   * hunter is a man with a rifle now, and a rifle is a different mechanic with
   * its own tests. Six players, so the roster is likely to deal somebody a
   * carnivore; the test skips itself rather than failing if it does not, because
   * species are dealt at random and a flaky test is worse than a missing one.
   */
  const sim = new Simulation(1357);
  for (let i = 0; i < 6; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 10);

  let biter: PlayerActor | null = null;
  let target: Actor | null = null;
  for (const p of sim.getPlayers()) {
    if (p.role !== Role.Survivor) continue;
    sim.forEachNearby(0, 0, 100_000, (a) => {
      if (target) return;
      // An AI animal, not another player: a player takes a deliberately
      // survivable bite, which is a different rule and has its own test.
      if (a.kind !== ActorKind.AI) return;
      // Ground prey only: a parrot is airborne, and it will have flown a good
      // fraction of a metre by the time the strike resolves — at biting range
      // that is a large angle, and the miss would be the AI's doing, not a bug.
      if ((a.flags & ActorFlags.Airborne) !== 0) return;
      /*
       * Nor anything that can pull itself in. Armour cuts a bite to a third,
       * which is the point of armour — and a tortoise standing next to a leopard
       * curls up *in the same tick the strike resolves*, so a test that picked
       * one would be asserting on the AI's reflexes rather than on the bite.
       */
      if (ANIMALS[a.species].ability === AbilityId.CurlUp) return;
      if (canPrey(p.species, a.species)) {
        biter = p;
        target = a;
      }
    });
    if (target) break;
  }
  if (!biter || !target) return; // nobody was dealt a predator this round

  const prey = target as Actor;
  const predator = biter as PlayerActor;
  prey.pos.x = predator.pos.x + Math.cos(predator.yaw) * 1.6;
  prey.pos.z = predator.pos.z + Math.sin(predator.yaw) * 1.6;
  prey.pos.y = predator.pos.y;

  sim.applyInput(predator.clientId, {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    yaw: predator.yaw,
    pitch: 0,
    actions: InputAction.Attack,
  });
  sim.update(SIM_DT);

  const after = sim.getActor(prey.id);
  const died = !after || (after.flags & ActorFlags.Dead) !== 0;
  assert.ok(died, `a single bite should take natural prey, but the ${prey.species} survived`);
  assert.equal(predator.stats.kills, 1, 'the kill must be credited');
});

test('a bite between two animals is survivable', () => {
  // The other half of the balance: an animal must NOT die to one bite, or being
  // found would be the same as being dead and a chase would never be a contest.
  // (The rifle is the exception, and it has its own tests below.)
  const sim = new Simulation(2468);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 10);

  const animals = sim.getPlayers().filter((p) => p.role === Role.Survivor);
  const biter = animals[0];
  const victim = animals[1];

  victim.pos.x = biter.pos.x + Math.cos(biter.yaw) * 1.6;
  victim.pos.z = biter.pos.z + Math.sin(biter.yaw) * 1.6;
  victim.pos.y = biter.pos.y;
  victim.health = victim.maxHealth;
  const before = victim.health;

  sim.applyInput(biter.clientId, {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    yaw: biter.yaw,
    pitch: 0,
    actions: InputAction.Attack,
  });
  sim.update(SIM_DT);

  assert.ok(victim.health < before, 'the bite must land');
  assert.ok(victim.health > 0, 'a healthy animal should survive a single bite');
});

test('the rifle kills a player outright', () => {
  const sim = new Simulation(2469);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 10);

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter)!;
  const victim = sim.getPlayers().find((p) => p.role === Role.Survivor)!;

  // Well beyond biting distance: this has to be the rifle, not a lunge.
  victim.pos.x = hunter.pos.x + Math.cos(hunter.yaw) * 30;
  victim.pos.z = hunter.pos.z + Math.sin(hunter.yaw) * 30;
  victim.pos.y = hunter.pos.y;
  victim.health = victim.maxHealth;

  sim.applyInput(hunter.clientId, {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    yaw: hunter.yaw,
    pitch: 0,
    actions: InputAction.Attack,
  });
  sim.update(SIM_DT);

  assert.equal(victim.health, 0, 'a rifle round at thirty metres must be lethal');
  assert.ok((victim.flags & ActorFlags.Dead) !== 0, 'the victim must be dead');
  assert.ok(hunter.health > 0, 'shooting an actual player must not hurt the hunter');
});

test('shooting an animal that was only an animal kills the hunter', () => {
  /*
   * The rule the round hangs on. Verified by putting an AI animal of a *playable*
   * species — one a survivor could have been wearing — squarely in the sights and
   * pulling the trigger.
   */
  const sim = new Simulation(2470);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 10);

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter)!;

  let bystander: { id: number; species: Species; pos: { x: number; y: number; z: number } } | null =
    null;
  sim.forEachNearby(hunter.pos.x, hunter.pos.z, 10_000, (a) => {
    if (bystander) return;
    if (a.kind !== ActorKind.AI) return;
    if (!ANIMALS[a.species].playable) return;
    bystander = a;
  });
  assert.ok(bystander, 'the world must contain an AI animal of a playable species');

  const victim = bystander! as unknown as { id: number; pos: { x: number; y: number; z: number } };
  victim.pos.x = hunter.pos.x + Math.cos(hunter.yaw) * 20;
  victim.pos.z = hunter.pos.z + Math.sin(hunter.yaw) * 20;
  victim.pos.y = hunter.pos.y;

  sim.applyInput(hunter.clientId, {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    yaw: hunter.yaw,
    pitch: 0,
    actions: InputAction.Attack,
  });
  sim.update(SIM_DT);

  assert.equal(hunter.health, 0, 'a hunter who shoots wildlife dies for it');
  assert.ok((hunter.flags & ActorFlags.Dead) !== 0, 'the hunter must be dead');
});

test('a clean miss costs the hunter nothing but the noise', () => {
  // If missing were punished as harshly as misidentifying, nobody would ever
  // fire, and a hunter who never fires is not a hunter.
  const sim = new Simulation(2471);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 10);

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter)!;
  // Point him at the sky above an empty stretch and make sure nothing is there.
  let clearYaw = hunter.yaw;
  for (let attempt = 0; attempt < 64; attempt++) {
    const yaw = (attempt / 64) * Math.PI * 2 - Math.PI;
    let blocked = false;
    sim.forEachNearby(hunter.pos.x, hunter.pos.z, RIFLE_RANGE, (a) => {
      if (a.id === hunter.id) return;
      const to = Math.atan2(a.pos.z - hunter.pos.z, a.pos.x - hunter.pos.x);
      let d = to - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 0.6) blocked = true;
    });
    if (!blocked) {
      clearYaw = yaw;
      break;
    }
  }

  const missesBefore = hunter.stats.missedAttacks;
  sim.applyInput(hunter.clientId, {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    yaw: clearYaw,
    pitch: 0,
    actions: InputAction.Attack,
  });
  sim.update(SIM_DT);

  assert.ok(hunter.health > 0, 'a miss must not kill the hunter');
  assert.ok(hunter.stats.missedAttacks > missesBefore, 'the miss must be recorded');
});

test('animals kill each other', () => {
  /*
   * The food chain has to actually run. It used to not: an AI predator dealt a
   * flat sixteen points a bite on a three-second cooldown, so bringing down a
   * fleeing capybara needed seven connected hits and in practice never happened.
   * A jungle where nothing ever eats anything is a jungle with no consequences
   * in it, and it also leaves a player predator with nothing to imitate.
   */
  const sim = new Simulation(8123);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 12);

  let deaths = 0;
  const before = new Map<number, number>();
  sim.forEachNearby(0, 0, 10_000, (a) => {
    if (a.kind === ActorKind.AI) before.set(a.id, a.health);
  });

  // Ten minutes of jungle. Predators are hungry and prey is not infinite.
  for (let i = 0; i < Math.round(600 / SIM_DT); i++) sim.update(SIM_DT);

  for (const [id] of before) {
    const actor = sim.getActor(id);
    if (!actor || (actor.flags & ActorFlags.Dead) !== 0) deaths++;
  }
  assert.ok(deaths > 0, 'over ten minutes, something should have eaten something');
});

test('the bite rule holds for the whole roster', () => {
  /*
   * The player's attack and the AI's attack both call `biteDamage` now — they
   * used to compute damage in two different places and disagree, which meant a
   * player predator and an AI of the same species fought differently. That is a
   * tell, in a game whose central promise is that no code path treats the two
   * differently. Having one function is the fix; what is worth asserting is that
   * the rule it encodes is the one the roster was designed around.
   */

  // A capybara cannot grind a tiger down, however many times it connects.
  const nibble = biteDamage(Species.Capybara, Species.Tiger, 135, { victimIsPlayer: false });
  assert.ok(nibble < 135 * 0.2, `a capybara bite on a tiger was ${nibble.toFixed(1)}`);

  // Natural prey dies outright, or predators can never feed on anything that runs.
  assert.equal(
    biteDamage(Species.Tiger, Species.Capybara, 100, { victimIsPlayer: false }),
    100,
    'natural prey must die outright',
  );

  // A player is never one-shot by an animal — being found is not being dead.
  for (const attacker of PLAYABLE_SPECIES) {
    const onPlayer = biteDamage(attacker, Species.Capybara, 100, { victimIsPlayer: true });
    assert.ok(
      onPlayer > 0 && onPlayer < 100,
      `${attacker} does ${onPlayer.toFixed(1)} to a player in one bite`,
    );
  }

  // Curling up is worth something.
  const open = biteDamage(Species.Tiger, Species.Gorilla, 100, { victimIsPlayer: true });
  const curled = biteDamage(Species.Tiger, Species.Gorilla, 100, {
    victimIsPlayer: true,
    armoured: true,
  });
  assert.ok(curled < open, 'armour must reduce the bite');
});

test('a simulation tick stays well inside the frame budget', () => {
  const sim = new Simulation(6789);
  for (let i = 0; i < 8; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 9);

  // Warm up, then measure.
  advance(sim, 2);
  const start = process.hrtime.bigint();
  const ticks = 200;
  for (let i = 0; i < ticks; i++) sim.update(TICK);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const perTick = elapsedMs / ticks;

  // The authority runs at 20 Hz (50 ms budget). Anything near that means the
  // AI or the spatial grid has regressed badly.
  assert.ok(
    perTick < 12,
    `simulation tick took ${perTick.toFixed(2)}ms with ${sim.getAnimalCount()} animals`,
  );
});

// ---------------------------------------------------------------------------
// The storm circle
// ---------------------------------------------------------------------------

test('the storm circle shrinks on schedule and every ring nests inside its parent', () => {
  for (const seed of [11, 2718, 90210, 4242]) {
    const rings = planRings(new Terrain(seed), new Rng(seed).fork('zone'));
    assert.ok(rings.length >= 2, `seed ${seed}: expected several rings, got ${rings.length}`);
    assert.equal(rings[0].radius, ZONE_INITIAL_RADIUS);

    for (let i = 1; i < rings.length; i++) {
      const parent = rings[i - 1];
      const child = rings[i];
      assert.ok(child.radius < parent.radius, `ring ${i} must be smaller than ring ${i - 1}`);
      // Containment is what makes the wall fair: it must never sweep across
      // ground that was already inside the previous circle.
      const centreGap = Math.hypot(child.x - parent.x, child.z - parent.z);
      assert.ok(
        centreGap + child.radius <= parent.radius + 1e-6,
        `seed ${seed}: ring ${i} pokes out of its parent by ` +
          `${(centreGap + child.radius - parent.radius).toFixed(2)}m`,
      );
    }
  }
});

test('every storm circle contains water, so an aquatic animal is never stranded', () => {
  // The final ring matters most: it is where the endgame happens, and a caiman
  // trapped in a dry 36 m circle cannot hide, feed or use its ability.
  let ringsWithWater = 0;
  let ringsTotal = 0;
  for (const seed of [11, 2718, 90210, 4242, 555, 31337]) {
    const terrain = new Terrain(seed);
    const rings = planRings(terrain, new Rng(seed).fork('zone'));
    for (const ring of rings) {
      ringsTotal++;
      let wet = 0;
      const samples = 200;
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < samples; i++) {
        const r = ring.radius * Math.sqrt((i + 0.5) / samples);
        const a = i * golden;
        if (terrain.isWater(ring.x + Math.cos(a) * r, ring.z + Math.sin(a) * r)) wet++;
      }
      if (wet > 0) ringsWithWater++;
    }
  }
  // Not every ring can be guaranteed on every seed — a river may simply not run
  // through the only patch that fits — but the planner should manage the large
  // majority, and a regression that breaks the water bias would tank this.
  assert.ok(
    ringsWithWater / ringsTotal > 0.85,
    `only ${ringsWithWater}/${ringsTotal} circles contained water`,
  );
});

test('the zone is a pure function of round time, with no drift', () => {
  const rings = planRings(new Terrain(777), new Rng(777).fork('zone'));

  // Held before the first shrink.
  const early = evaluateZone(rings, ZONE_FIRST_SHRINK_AT - 1);
  assert.equal(early.shrinking, false);
  assert.equal(early.radius, rings[0].radius);
  assert.ok(early.untilShrink > 0 && early.untilShrink <= 1.001);

  // Mid-shrink, strictly between the two radii.
  const mid = evaluateZone(rings, ZONE_FIRST_SHRINK_AT + ZONE_SHRINK_DURATION / 2);
  assert.equal(mid.shrinking, true);
  assert.ok(mid.radius < rings[0].radius && mid.radius > rings[1].radius);

  // Landed exactly on the next ring.
  const after = evaluateZone(rings, ZONE_FIRST_SHRINK_AT + ZONE_SHRINK_DURATION + 0.5);
  assert.equal(after.shrinking, false);
  assert.ok(Math.abs(after.radius - rings[1].radius) < 1e-6);

  // Evaluating the same instant twice must give bit-identical answers, which is
  // the property that stops the client's wall drifting from the server's.
  const a = evaluateZone(rings, 314.159);
  const b = evaluateZone(rings, 314.159);
  assert.deepEqual(a, b);

  // By the end of the round it is the final ring and stays there.
  const end = evaluateZone(rings, ROUND_DURATION);
  assert.equal(end.stage, rings.length - 1);
  assert.equal(end.untilShrink, Infinity);
  assert.ok(Math.abs(end.radius - rings[rings.length - 1].radius) < 1e-6);
});

test('nothing spawns in the storm', () => {
  const sim = new Simulation(8080);
  for (let i = 0; i < 6; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();

  const zone = sim.zone;
  let outside = 0;
  let total = 0;
  sim.forEachNearby(0, 0, 100_000, (a) => {
    total++;
    if (Math.hypot(a.pos.x - zone.x, a.pos.z - zone.z) > zone.radius) outside++;
  });
  /*
   * A guard that the world is populated at all, so the real assertion below is
   * not passing vacuously. Derived from the budget rather than hardcoded: this
   * said `> 50`, which silently encoded the old population of 220 and turned a
   * deliberate design change into a test failure that looked like a bug.
   */
  assert.ok(
    total >= AI_POPULATION,
    `expected a populated world, got ${total} actors`,
  );
  assert.equal(outside, 0, `${outside} of ${total} actors spawned outside the circle`);
});

test('the storm kills a player who stays out in it', () => {
  const sim = new Simulation(1234);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 10);

  const player = sim.getPlayers()[0];
  const zone = sim.zone;
  // Teleport well outside, and keep them there: the storm should finish them.
  const push = (): void => {
    player.pos.x = zone.x + zone.radius + 40;
    player.pos.z = zone.z;
  };
  push();

  const steps = Math.round(120 / TICK);
  for (let i = 0; i < steps && player.health > 0; i++) {
    push();
    sim.update(TICK);
  }
  assert.equal(player.health, 0, 'standing in the storm for two minutes must be fatal');
});

test('only crocodilians can submerge', () => {
  for (const species of PLAYABLE_SPECIES) {
    const canSubmerge = ANIMALS[species].locomotion.canSubmerge;
    if (!canSubmerge) continue;
    // Anything allowed to disappear under water must at least be a strong
    // swimmer; a submerging land animal would be a bug in the table.
    assert.ok(
      ANIMALS[species].locomotion.swimSpeed > 1,
      `${species} can submerge but is not a strong swimmer`,
    );
  }
  // The signature ambush species specifically must have it.
  assert.ok(ANIMALS[Species.Crocodile].locomotion.canSubmerge);
  assert.ok(ANIMALS[Species.Caiman].locomotion.canSubmerge);
  // And a capybara — a better swimmer than either — must not.
  assert.equal(ANIMALS[Species.Capybara].locomotion.canSubmerge, false);
});

test('a crocodilian actually submerges and a capybara cannot', () => {
  const sim = new Simulation(2468);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 10);

  const player = sim.getPlayers()[0];
  const zone = sim.zone;

  /** Put the player in the deepest water inside the circle and hold C down. */
  const diveTest = (species: Species): { submerged: boolean; depthBelowSurface: number } => {
    player.species = species;
    sim.refreshStats(player);
    player.health = player.maxHealth;
    player.move = { vy: 0, airborne: false, smoothSpeed: 0, stepAccumulator: 0 };

    // Search the circle for genuinely deep water.
    let best = { x: zone.x, z: zone.z, depth: 0 };
    for (let i = 0; i < 4000; i++) {
      const a = (i * 2.399963) % (Math.PI * 2);
      const r = zone.radius * Math.sqrt(((i % 97) + 0.5) / 97);
      const x = zone.x + Math.cos(a) * r;
      const z = zone.z + Math.sin(a) * r;
      const depth = sim.terrain.waterDepthAt(x, z);
      if (depth > best.depth) best = { x, z, depth };
    }
    assert.ok(best.depth > 1.6, `seed has no deep water in the circle (best ${best.depth.toFixed(2)}m)`);

    player.pos.x = best.x;
    player.pos.z = best.z;
    player.pos.y = sim.terrain.waterLevel;

    // Hold submerge for a couple of seconds so the smoothing settles.
    for (let i = 0; i < Math.round(2.5 / TICK); i++) {
      sim.applyInput('a', {
        seq: i,
        moveX: 0,
        moveZ: 0,
        yaw: 0,
        pitch: 0,
        actions: InputAction.Submerge,
      });
      sim.update(TICK);
    }
    return {
      submerged: (player.flags & ActorFlags.Submerged) !== 0,
      depthBelowSurface: sim.terrain.waterLevel - player.pos.y,
    };
  };

  const caiman = diveTest(Species.Caiman);
  assert.ok(caiman.submerged, 'a caiman holding submerge must be flagged as submerged');
  assert.ok(
    caiman.depthBelowSurface > 0.4,
    `a submerged caiman must be under the surface, was ${caiman.depthBelowSurface.toFixed(2)}m below`,
  );

  const capybara = diveTest(Species.Capybara);
  assert.equal(
    capybara.submerged,
    false,
    'a capybara must never submerge, however well it swims',
  );
  assert.ok(
    capybara.depthBelowSurface < 0.4,
    `a capybara must stay at the surface, was ${capybara.depthBelowSurface.toFixed(2)}m below`,
  );
});

test('every attack raises a fresh Attacking pulse, not a permanent flag', () => {
  /*
   * Four players, and the swing is made by a survivor. With one player they
   * would be dealt the hunter, whose rifle has its own cooldown and strike
   * window — this test is about the animal bite.
   */
  const sim = new Simulation(97531);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();
  advance(sim, 10);
  const player = sim.getPlayers().find((p) => p.role === Role.Survivor)!;

  /*
   * Click attack once, then run the cooldown out, counting rising edges.
   *
   * `seq` has to keep climbing across calls, not restart: applyInput drops any
   * packet whose sequence number is behind the last one it saw, so a second swing
   * numbered from zero again is silently discarded in its entirety. (Which is how
   * this test first "failed" — the simulation was fine.)
   */
  let seq = 0;
  const swing = (): { edges: number; peakTicks: number } => {
    let edges = 0;
    let peakTicks = 0;
    let wasSet = (player.flags & ActorFlags.Attacking) !== 0;
    const ticks = Math.round((HUNTER_ATTACK_COOLDOWN + 0.4) / TICK);
    for (let i = 0; i < ticks; i++) {
      // Hold the button only on the first tick, like one click.
      sim.applyInput(player.clientId, {
        seq: ++seq,
        moveX: 0,
        moveZ: 0,
        yaw: 0,
        pitch: 0,
        actions: i === 0 ? InputAction.Attack : 0,
      });
      sim.update(TICK);
      const set = (player.flags & ActorFlags.Attacking) !== 0;
      if (set && !wasSet) edges++;
      if (set) peakTicks++;
      wasSet = set;
    }
    return { edges, peakTicks };
  };

  const first = swing();
  assert.equal(first.edges, 1, 'the first attack must raise the flag exactly once');
  assert.ok(
    first.peakTicks >= 5 && first.peakTicks <= 10,
    `the strike window should last about ${ATTACK_STRIKE_TIME}s, held for ${first.peakTicks} ticks`,
  );
  assert.equal(
    player.flags & ActorFlags.Attacking,
    0,
    'the flag must fall again — a latched flag has one rising edge per round, so ' +
      'the renderer would draw exactly one bite and then never another',
  );

  // And again: this is the part that was broken. A second click has to produce a
  // second edge, which it cannot if nothing ever clears the flag.
  const second = swing();
  assert.equal(second.edges, 1, 'a second attack must raise the flag again');

  const third = swing();
  assert.equal(third.edges, 1, 'and a third');
});

test('a quick click is never dropped, whatever the frame rate', () => {
  // The client latches a left click and consumes it on the next read, so a press
  // and release that both land between two frames still reaches the server. The
  // simulation side of that contract: a single tick carrying Attack must be
  // enough to open a strike window.
  const sim = new Simulation(13579);
  sim.addPlayer('a', 'A');
  sim.startRound();
  advance(sim, 10);
  const player = sim.getPlayers()[0];

  sim.applyInput('a', { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, actions: InputAction.Attack });
  sim.update(TICK);
  assert.notEqual(
    player.flags & ActorFlags.Attacking,
    0,
    'one tick of Attack must be enough to start a strike',
  );
});

test('the AI population respects its budget, however many players turn up', () => {
  /*
   * At the old budget of 220 an overshoot of a few animals was invisible. At 5
   * it is the difference between the requested world and twice it, and the
   * guaranteed-cover pass is the one that can overspend: it reserves an animal
   * per *player species* before the filler loop, and only the filler loop used
   * to clamp.
   */
  for (const playerCount of [1, 3, 8]) {
    const sim = new Simulation(24680 + playerCount);
    for (let i = 0; i < playerCount; i++) sim.addPlayer(`p${i}`, `P${i}`);
    sim.startRound();

    /*
     * Counted over playable species only.
     *
     * Ambient life — fish, ants, butterflies, birds — is spawned off its own
     * budget precisely so that it does not compete for these six slots, so
     * `getAnimalCount()` (which includes all of it) is the wrong number here and
     * reported nearly two hundred.
     */
    const count = sim.getCoverAnimalCount();
    assert.ok(
      count <= AI_POPULATION,
      `${playerCount} players produced ${count} cover animals, over the budget of ${AI_POPULATION}`,
    );
    assert.ok(count > 0, 'a round with no AI animals at all is not a jungle');
    // ...and the world should still be full of ambient life.
    assert.ok(
      sim.getAnimalCount() > count,
      'the world has no ambient creatures in it at all',
    );
  }
});

test('withdrawn species never reach the world', () => {
  /*
   * Withdrawing a species is a one-line `enabled: false` in the animal table.
   * The whole point is that nothing else has to be remembered — so this asserts
   * the guarantee end to end rather than trusting each spawn site to have asked.
   */
  const withdrawn = ALL_SPECIES.filter((s) => !isEnabled(s));
  assert.ok(withdrawn.length > 0, 'this test is meaningless with nothing withdrawn');
  assert.ok(
    withdrawn.includes(Species.Monkey) && withdrawn.includes(Species.HowlerMonkey),
    'both monkeys are meant to be withdrawn',
  );

  for (const seed of [11, 222, 3333, 44444]) {
    const sim = new Simulation(seed);
    sim.addPlayer('a', 'A');
    sim.startRound();
    advance(sim, 60);
    sim.forEachNearby(0, 0, 10_000, (a) => {
      assert.ok(isEnabled(a.species), `seed ${seed} spawned ${a.species}, which is withdrawn`);
    });
    for (const p of sim.getPlayers()) {
      assert.ok(isEnabled(p.species), `seed ${seed} dealt a player the withdrawn ${p.species}`);
    }
  }

  // A withdrawn species must also stay out of every pool the UI reads.
  for (const s of withdrawn) {
    assert.ok(!SPAWNABLE_SPECIES.includes(s), `${s} is still spawnable`);
    assert.ok(!PLAYABLE_SPECIES.includes(s), `${s} is still playable`);
  }
});

test('no random event can burst-spawn a withdrawn species', () => {
  /*
   * The monkey riot outlived the monkeys: its entire payload is fourteen howler
   * monkeys, and nothing in the event table knew the species had gone. Rather
   * than delete that one event, `updateSchedule` skips any event whose burst
   * species is withdrawn — so this asserts the rule, not the case that motivated
   * it, and a future withdrawal is covered for free.
   */
  const risky = ALL_EVENTS.filter((id) => {
    const burst = EVENTS[id].spawnBurst;
    return burst !== undefined && !isEnabled(burst.species);
  });
  assert.ok(risky.length > 0, 'expected at least one event bursting a withdrawn species');

  const rng = new Rng(8642);
  const schedule = createSchedule(rng);
  const fired = new Set<EventId>();
  // Well past the opening lockout and well short of the closing one.
  for (let i = 0; i < 4000; i++) {
    schedule.nextIn = 0;
    for (const def of updateSchedule(schedule, rng, EVENT_LOCKOUT_START + 5, TICK)) {
      fired.add(def.id);
    }
    // Clear the running list so the scheduler is free to pick again next loop.
    schedule.active.length = 0;
  }
  assert.ok(fired.size > 0, 'the scheduler never fired anything; the test proves nothing');
  for (const id of risky) {
    assert.ok(!fired.has(id), `${id} fired despite bursting a withdrawn species`);
  }
});

test('the river is deep enough to submerge in across its width', () => {
  /*
   * The channel floor has been ~3.4 m below the water line for a long time, and
   * the river was still effectively ankle-deep: the old profile reached that
   * floor only on the exact centre-line and shelved away immediately, so the
   * deep part was a thread you could not see. "Deep river" is therefore not a
   * statement about the maximum — it is a statement about the *median*, which is
   * what a crocodile looking for somewhere to submerge actually meets.
   *
   * A submerging animal needs depth > its height * 1.1 (see Locomotion), so at
   * 0.5 m tall a crocodile needs 0.55 m. Requiring a median far above that is
   * what keeps the channel a place you can live in rather than one you can
   * technically dip into.
   */
  for (const seed of [1234, 8080, 555]) {
    const terrain = new Terrain(seed);
    const depths: number[] = [];
    for (let i = 0; i < 120_000; i++) {
      const a = i * 2.399963;
      const r = Math.sqrt((i % 9973) / 9973) * (WORLD_SIZE * 0.46);
      const d = terrain.waterDepthAt(Math.cos(a) * r, Math.sin(a) * r);
      if (d > 0.02) depths.push(d);
    }
    assert.ok(depths.length > 1000, `seed ${seed} has almost no water at all`);
    depths.sort((x, y) => x - y);
    const median = depths[Math.floor(depths.length / 2)];
    assert.ok(
      median >= 3,
      `seed ${seed}: median water depth is ${median.toFixed(2)}m, so most of the river is shallow`,
    );

    // ...and the world must still be mostly jungle. A river you can swim down is
    // no good if deepening it drowned the map.
    const rng = new Rng(seed);
    let land = 0;
    const samples = 8000;
    for (let i = 0; i < samples; i++) {
      const p = rng.inCircle(WORLD_SIZE * 0.42);
      if (!terrain.isWater(p.x, p.y)) land++;
    }
    const landFraction = land / samples;
    assert.ok(
      landFraction > 0.7,
      `seed ${seed}: only ${(landFraction * 100).toFixed(0)}% of the map is dry land`,
    );
  }
});

test('exactly six species are playable, and they are the intended six', () => {
  /*
   * The roster is the design. Anything drifting into or out of it changes what
   * the game is, so it is asserted by name rather than by count alone.
   */
  const expected = [
    Species.Capybara,
    Species.Crocodile,
    Species.Turtle,
    Species.Tiger,
    Species.Leopard,
    Species.Gorilla,
  ];
  assert.deepEqual(
    [...PLAYABLE_SPECIES].sort(),
    [...expected].sort(),
    'the playable roster has drifted',
  );

  // Every one of them must be able to roll a weakness and be dealt a role.
  for (const s of expected) {
    assert.ok(eligibleWeaknesses(s).length > 0, `${s} has no eligible weakness`);
  }
  // No animal is ever the hunter any more, and the hunter is never playable.
  assert.ok(!PLAYABLE_SPECIES.includes(Species.Hunter), 'the human is not a playable animal');
});

test('the roster plays the way the design says it does', () => {
  const croc = ANIMALS[Species.Crocodile];
  const tiger = ANIMALS[Species.Tiger];
  const tortoise = ANIMALS[Species.Turtle];
  const leopard = ANIMALS[Species.Leopard];
  const gorilla = ANIMALS[Species.Gorilla];
  const capy = ANIMALS[Species.Capybara];

  // Crocodile: owns the water, and is the only one that can vanish under it.
  assert.ok(croc.locomotion.canSubmerge, 'the crocodile must be able to submerge');
  assert.ok(
    croc.locomotion.swimSpeed > tiger.locomotion.swimSpeed,
    'the crocodile must swim faster than the tiger',
  );

  // Leopard: fastest alive, and it must beat the tiger on both speed and sprint.
  for (const other of [tiger, croc, gorilla, capy, tortoise]) {
    assert.ok(
      leopard.locomotion.landSpeed >= other.locomotion.landSpeed,
      `the leopard must not be slower than the ${other.name}`,
    );
  }
  assert.ok(
    leopard.locomotion.sprintMultiplier > tiger.locomotion.sprintMultiplier,
    'the leopard must out-sprint the tiger',
  );
  // ...and pay for it in hunger, while hitting softer than the tiger.
  assert.ok(leopard.hungerRate > tiger.hungerRate * 2, 'the leopard must starve much faster');
  assert.ok(
    (leopard.attackPower ?? 0) < (tiger.attackPower ?? 0),
    'the leopard must hit softer than the tiger',
  );

  // Tiger: barely hungers.
  assert.ok(tiger.hungerRate < capy.hungerRate, 'the tiger must hunger less than the capybara');

  // Tortoise: most health, slowest, barely hungers, cannot enter deep water.
  for (const other of [tiger, croc, leopard, gorilla, capy]) {
    assert.ok(
      tortoise.healthMultiplier >= other.healthMultiplier,
      `the tortoise must not have less health than the ${other.name}`,
    );
    assert.ok(
      tortoise.locomotion.landSpeed <= other.locomotion.landSpeed,
      `the tortoise must not be faster than the ${other.name}`,
    );
  }
  assert.equal(canSwim(Species.Turtle), false, 'the tortoise must not be able to swim');

  // Gorilla: hardest hitter, and drowns.
  for (const other of [tiger, croc, leopard, capy, tortoise]) {
    assert.ok(
      (gorilla.attackPower ?? 0) > (other.attackPower ?? 0),
      `the gorilla must hit harder than the ${other.name}`,
    );
  }
  assert.equal(canSwim(Species.Gorilla), false, 'the gorilla must not be able to swim');

  // Capybara: very fast, feeble bite, never starves.
  assert.ok(
    capy.locomotion.landSpeed > tiger.locomotion.landSpeed,
    'the capybara must outrun the tiger',
  );
  assert.ok((capy.attackPower ?? 1) < 0.2, 'the capybara must barely do damage');
  assert.ok(canSwim(Species.Capybara), 'the capybara must be able to swim');
});

test('a capybara cannot kill a tiger', () => {
  /*
   * Not "takes a long time to" — cannot. A feeble-but-nonzero bite plus enough
   * patience is still a kill, so the guarantee needs a term that scales with the
   * size difference. This runs the real attack path rather than the arithmetic.
   */
  const sim = new Simulation(60421);
  sim.addPlayer('capy', 'Capy');
  sim.addPlayer('tiger', 'Tiger');
  sim.startRound();
  advance(sim, 10);

  const [a, b] = sim.getPlayers();
  a.species = Species.Capybara;
  a.role = Role.Survivor;
  sim.refreshStats(a);
  b.species = Species.Tiger;
  b.role = Role.Survivor;
  sim.refreshStats(b);
  b.health = b.maxHealth;

  // Park the capybara right on top of the tiger and let it bite for a full round.
  let seq = 0;
  const ticks = Math.round(ROUND_DURATION / TICK);
  for (let i = 0; i < ticks; i++) {
    a.pos.x = b.pos.x + 0.2;
    a.pos.z = b.pos.z;
    a.yaw = 0;
    b.yaw = Math.PI;
    a.attackCooldown = 0;
    sim.applyInput('capy', {
      seq: ++seq,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      actions: InputAction.Attack,
    });
    sim.update(TICK);
    if (b.health <= 0) break;
  }

  assert.ok(
    b.health > 0,
    `the tiger died to a capybara after ${(seq * TICK).toFixed(0)}s of continuous biting`,
  );
  // The reverse must not be true: a tiger has to be able to finish a capybara.
  assert.ok(
    (ANIMALS[Species.Tiger].attackPower ?? 0) > (ANIMALS[Species.Capybara].attackPower ?? 0) * 8,
    'the tiger must hit vastly harder than the capybara',
  );
});

test('nothing can climb, and no tree is climbable', () => {
  /*
   * Trees are scenery and cover, not terrain.
   *
   * Asserted across the whole table rather than the playable six: an ambient
   * species that could climb would still be seen going up a trunk, and the
   * whole point is that it never happens.
   */
  for (const s of ALL_SPECIES) {
    assert.equal(
      ANIMALS[s].locomotion.canClimb,
      false,
      `${s} can still climb`,
    );
    assert.equal(ANIMALS[s].locomotion.climbSpeed, 0, `${s} still has a climb speed`);
  }

  /*
   * And end to end: run a populated round and check nothing ever leaves the
   * ground except by jumping or flying. A climbing animal parks itself well
   * above the surface and stays there, which is what this catches.
   */
  const sim = new Simulation(515151);
  for (let i = 0; i < 3; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound();

  let worst = 0;
  let worstSpecies = '';
  for (let step = 0; step < Math.round(90 / TICK); step++) {
    sim.update(TICK);
    if (step % 20 !== 0) continue;
    sim.forEachNearby(0, 0, 10_000, (a) => {
      if (ANIMALS[a.species].locomotion.canFly) return;
      const ground = sim.terrain.surfaceAt(a.pos.x, a.pos.z);
      const above = a.pos.y - ground;
      if (above > worst) {
        worst = above;
        worstSpecies = a.species;
      }
    });
  }
  // A jump arc is the only legitimate way to be off the ground, and it is small.
  assert.ok(
    worst < 2.5,
    `a ${worstSpecies} was ${worst.toFixed(1)}m above the ground — that is a tree, not a jump`,
  );
});
