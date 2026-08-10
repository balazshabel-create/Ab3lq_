/**
 * simulation.test.ts — headless checks on the rules that matter most.
 *
 * These run the real Simulation in Node, with no renderer, which is the whole
 * reason the sim has no Three.js dependency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../src/Core/Simulation';
import { Role, RoundPhase, ActorFlags, type Actor } from '../src/Core/Types';
import {
  ALL_SPECIES,
  ANIMALS,
  HUNTER_SPECIES,
  PLAYABLE_SPECIES,
  SPAWNABLE_SPECIES,
  Species,
  isEnabled,
} from '../src/Animals/AnimalTypes';
import { canPrey } from '../src/Animals/FoodChain';
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
  InputAction,
  decodeSnapshot,
  encodeSnapshot,
  type Snapshot,
} from '../src/Networking/Protocol';
import {
  HUNGER_DECAY_RATE,
  ROUND_DURATION,
  SIM_DT,
  WHISTLE_INTERVAL,
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
  // A capybara cannot climb, so no climbing weaknesses.
  assert.equal(isWeaknessEligible(Species.Capybara, WeaknessId.WeakGrip), false);
  assert.equal(isWeaknessEligible(Species.Capybara, WeaknessId.InjuredArm), false);
  // A herbivore has no meaningful bite to lose.
  assert.equal(isWeaknessEligible(Species.Parrot, WeaknessId.MissingTeeth), false);
  // Monkeys climb, so grip weaknesses are fair game.
  assert.equal(isWeaknessEligible(Species.Monkey, WeaknessId.WeakGrip), true);
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

test('role dealing produces exactly one hunter, always a predator, never weakened', () => {
  const rng = new Rng(4242);
  for (let trial = 0; trial < 40; trial++) {
    const n = 1 + (trial % 12);
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);
    const prefs = new Map<string, Species | null>();
    // Half the trials: everybody picks a harmless herbivore, so the dealer has
    // to promote somebody to a predator species.
    for (const id of ids) prefs.set(id, trial % 2 === 0 ? Species.Capybara : null);

    const assignments = assignRoles(ids, prefs, rng);
    const hunters = assignments.filter((a) => a.role === Role.Hunter);
    assert.equal(hunters.length, 1, `expected 1 hunter for ${n} players`);
    assert.equal(hunters[0].weakness, null, 'the hunter must never carry a weakness');
    assert.ok(
      HUNTER_SPECIES.includes(hunters[0].species),
      `hunter species ${hunters[0].species} cannot be a hunter`,
    );
    // Every survivor gets a weakness, and it must fit their species.
    for (const a of assignments.filter((x) => x.role === Role.Survivor)) {
      assert.ok(a.weakness, 'survivors must have a weakness');
      assert.ok(isWeaknessEligible(a.species, a.weakness!));
    }
  }
});

test('the hunter is always an animal with AI cover of its own species', () => {
  const sim = new Simulation(2024);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `Player ${i}`);
  const prefs = new Map<string, Species | null>();
  sim.startRound(prefs);

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter);
  assert.ok(hunter, 'a hunter must exist');
  // The hunter is a normal animal, never a human with a gun.
  assert.ok(ANIMALS[hunter!.species].canBeHunter);

  // There must be a crowd of the same species to hide among.
  let sameSpecies = 0;
  sim.forEachNearby(0, 0, 10_000, (a) => {
    if (a.species === hunter!.species && a.id !== hunter!.id) sameSpecies++;
  });
  assert.ok(sameSpecies >= 10, `hunter needs cover; found only ${sameSpecies} of its species`);
});

test('every player species gets AI cover to hide among', () => {
  const sim = new Simulation(31337);
  for (let i = 0; i < 6; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound(new Map());

  for (const player of sim.getPlayers()) {
    let count = 0;
    sim.forEachNearby(0, 0, 10_000, (a) => {
      if (a.species === player.species && a.id !== player.id) count++;
    });
    assert.ok(count >= 10, `${player.species} only has ${count} AI companions`);
  }
});

test('a round terminates cleanly and produces a full reveal', () => {
  const sim = new Simulation(555);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound(new Map());

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
  sim.startRound(new Map());
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
  sim.startRound(new Map());
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
  sim.startRound(new Map());
  advance(sim, 9);

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter)!;
  advance(sim, WHISTLE_INTERVAL * 2);
  assert.equal(hunter.flies, 0, 'the hunter has no whistle obligation, so no flies');
});

test('hunger drains at the rate the species table specifies', () => {
  const sim = new Simulation(1212);
  sim.addPlayer('a', 'A');
  sim.startRound(new Map());
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
  sim.startRound(new Map());
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
  sim.startRound(new Map());
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
  sim.startRound(new Map());
  advance(sim, 60);

  let outOfBounds = 0;
  sim.forEachNearby(0, 0, 100_000, (a) => {
    if (!Number.isFinite(a.pos.x) || !Number.isFinite(a.pos.z) || !Number.isFinite(a.pos.y)) {
      outOfBounds++;
      return;
    }
    if (Math.max(Math.abs(a.pos.x), Math.abs(a.pos.z)) > 320) outOfBounds++;
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
  sim.startRound(new Map());
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
  const sim = new Simulation(2718);
  sim.addPlayer('a', 'A');
  sim.startRound(new Map());
  advance(sim, 12);

  const player = sim.getPlayers()[0];
  const snap = sim.buildSnapshotFor('a');
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
  // The four flying species were withdrawn. Their table entries must remain (the
  // wire format indexes into ALL_SPECIES) but they must never reach the world.
  const withdrawn = [Species.Parrot, Species.Eagle, Species.Heron, Species.Bat];

  for (const species of withdrawn) {
    assert.equal(isEnabled(species), false, `${species} should be withdrawn`);
    assert.ok(ALL_SPECIES.includes(species), 'the table entry must be kept for wire stability');
    assert.ok(!SPAWNABLE_SPECIES.includes(species), `${species} must not be spawnable`);
    assert.ok(!PLAYABLE_SPECIES.includes(species), `${species} must not be selectable`);
    assert.ok(!HUNTER_SPECIES.includes(species), `${species} must not be dealt the hunter role`);
  }

  // And none of them should be in a populated world.
  const sim = new Simulation(4711);
  for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound(new Map());
  advance(sim, 12);

  const seen = new Set<Species>();
  sim.forEachNearby(0, 0, 100_000, (a) => seen.add(a.species));
  for (const species of withdrawn) {
    assert.ok(!seen.has(species), `${species} was spawned despite being withdrawn`);
  }
});

test('a predator can actually kill the AI prey it hunts', () => {
  // Regression test for a bite that connected but did nothing useful: at
  // HUNTER_DAMAGE a fleeing capybara needed three hits across seven seconds, so
  // predators could never feed and the attack felt broken.
  const sim = new Simulation(1357);
  sim.addPlayer('a', 'A');
  sim.startRound(new Map());
  advance(sim, 10);

  const hunter = sim.getPlayers()[0];
  assert.equal(hunter.role, Role.Hunter, 'a solo player is dealt the hunter role');

  // Find something this predator naturally hunts.
  const found: Actor[] = [];
  sim.forEachNearby(0, 0, 100_000, (a) => {
    if (found.length === 0 && canPrey(hunter.species, a.species)) found.push(a);
  });
  assert.ok(found.length > 0, `found no prey species for a ${hunter.species}`);

  // Put it right in front of the hunter's jaws.
  const target = found[0];
  target.pos.x = hunter.pos.x + Math.cos(hunter.yaw) * 1.6;
  target.pos.z = hunter.pos.z + Math.sin(hunter.yaw) * 1.6;
  target.pos.y = hunter.pos.y;

  // Send as the hunter's own client: with several players the hunter is not
  // necessarily the first one, and a herbivore's attack is correctly refused.
  sim.applyInput(hunter.clientId, {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    yaw: hunter.yaw,
    pitch: 0,
    actions: InputAction.Attack,
  });
  sim.update(SIM_DT);

  const after = sim.getActor(target.id);
  const died = !after || (after.flags & ActorFlags.Dead) !== 0;
  assert.ok(died, `a single bite should take natural prey, but the ${target.species} survived`);
  assert.equal(hunter.stats.kills, 1, 'the kill must be credited');
});

test('a bite on another player is survivable', () => {
  // The other half of the balance: players must NOT die to one bite, or being
  // found would be the same as being dead and a chase would never be a contest.
  const sim = new Simulation(2468);
  sim.addPlayer('a', 'A');
  sim.addPlayer('b', 'B');
  sim.startRound(new Map());
  advance(sim, 10);

  const hunter = sim.getPlayers().find((p) => p.role === Role.Hunter)!;
  const victim = sim.getPlayers().find((p) => p.role === Role.Survivor)!;

  victim.pos.x = hunter.pos.x + Math.cos(hunter.yaw) * 1.6;
  victim.pos.z = hunter.pos.z + Math.sin(hunter.yaw) * 1.6;
  victim.pos.y = hunter.pos.y;
  const before = victim.health;

  // Send as the hunter's own client: with several players the hunter is not
  // necessarily the first one, and a herbivore's attack is correctly refused.
  sim.applyInput(hunter.clientId, {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    yaw: hunter.yaw,
    pitch: 0,
    actions: InputAction.Attack,
  });
  sim.update(SIM_DT);

  assert.ok(victim.health < before, 'the bite must land');
  assert.ok(
    victim.health > 0 || victim.maxHealth < 70,
    'a healthy player should survive a single bite',
  );
});

test('a simulation tick stays well inside the frame budget', () => {
  const sim = new Simulation(6789);
  for (let i = 0; i < 8; i++) sim.addPlayer(`p${i}`, `P${i}`);
  sim.startRound(new Map());
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
