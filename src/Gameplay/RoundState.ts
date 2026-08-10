/**
 * RoundState.ts — role dealing, the ten minute clock, and the reveal.
 *
 * The role deal is the most sensitive code in the project: if the hunter's
 * identity leaks, the game is over before it starts. So the rules are:
 *   • Exactly one hunter per round, chosen from the species that can plausibly
 *     kill other animals.
 *   • The hunter is always an animal, never a human with a rifle. It looks
 *     exactly like the AI instances of its own species, and the simulation
 *     guarantees a healthy population of those to hide among.
 *   • Survivors each get a secret weakness; the hunter gets none.
 *   • A player is told their own role and weakness and nothing else. The full
 *     assignment is only broadcast after the final whistle.
 */

import {
  MIN_PLAYERS,
  ROUND_DURATION,
  ROUND_INTRO_DURATION,
  ROUND_OVER_DURATION,
} from '../Systems/Config';
import {
  ANIMALS,
  HUNTER_SPECIES,
  PLAYABLE_SPECIES,
  Species,
  SizeClass,
} from '../Animals/AnimalTypes';
import { Rng } from '../Systems/Rng';
import { Role, RoundPhase, type PlayerActor } from '../Core/Types';
import { WeaknessId, WEAKNESSES, rollWeakness } from './Weaknesses';

/** A player's private role card, sent only to that player. */
export interface RoleCard {
  role: Role;
  species: Species;
  weakness: WeaknessId | null;
  /** Copy shown on the intro screen. */
  title: string;
  subtitle: string;
  objective: string;
}

/** Public round status, safe to send to everybody. */
export interface RoundStatus {
  phase: RoundPhase;
  /** Seconds remaining in the current phase. */
  timeLeft: number;
  /** Seconds elapsed since the round proper began. */
  elapsed: number;
  survivorsAlive: number;
  survivorsTotal: number;
  /** Set only once the round is over. */
  result: RoundResult | null;
}

export enum Winner {
  Survivors = 'survivors',
  Hunter = 'hunter',
  Draw = 'draw',
}

/** The full reveal, broadcast when the round ends. */
export interface RoundResult {
  winner: Winner;
  hunterName: string;
  hunterSpecies: Species;
  hunterKills: number;
  hunterMissed: number;
  hunterBestKill: Species | null;
  survivorsAlive: number;
  survivorsTotal: number;
  /** Everybody's role, species and weakness — now public. */
  reveals: PlayerReveal[];
  /** The funny statistics. */
  awards: Award[];
  durationPlayed: number;
}

export interface PlayerReveal {
  clientId: string;
  name: string;
  role: Role;
  species: Species;
  weakness: WeaknessId | null;
  survived: boolean;
  survivedSeconds: number;
  kills: number;
  mealsEaten: number;
  whistles: number;
  killedBy: string | null;
}

export interface Award {
  emoji: string;
  title: string;
  playerName: string;
  detail: string;
}

/** Everything the authority tracks about the current match. */
export interface Round {
  phase: RoundPhase;
  /** Seconds remaining in the current phase. */
  phaseTimer: number;
  elapsed: number;
  seed: number;
  hunterClientId: string | null;
  result: RoundResult | null;
}

export function createRound(seed: number): Round {
  return {
    phase: RoundPhase.Lobby,
    phaseTimer: 0,
    elapsed: 0,
    seed,
    hunterClientId: null,
    result: null,
  };
}

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

export interface RoleAssignment {
  clientId: string;
  role: Role;
  species: Species;
  weakness: WeaknessId | null;
}

/**
 * Deal roles for a new round.
 *
 * `preferredSpecies` honours what each player picked in the lobby, falling back
 * to a random playable species. The hunter is drawn from the players whose
 * choice can be a hunter; if nobody picked a predator, one player is
 * reassigned to a predator species — being handed a crocodile is itself the
 * tell-free way of saying "you are the hunter", since only that player knows.
 */
export function assignRoles(
  clientIds: string[],
  preferredSpecies: Map<string, Species | null>,
  rng: Rng,
): RoleAssignment[] {
  if (clientIds.length === 0) return [];

  // Resolve each player's species first.
  const species = new Map<string, Species>();
  for (const id of clientIds) {
    const pick = preferredSpecies.get(id) ?? null;
    species.set(id, pick && PLAYABLE_SPECIES.includes(pick) ? pick : rng.pick(PLAYABLE_SPECIES));
  }

  // Pick the hunter. Prefer somebody who already chose a predator so we do not
  // have to override anyone's choice.
  const shuffled = rng.shuffle([...clientIds]);
  let hunterId = shuffled.find((id) => ANIMALS[species.get(id)!].canBeHunter);
  if (!hunterId) {
    // Nobody chose a predator: promote one player and swap their species.
    hunterId = shuffled[0];
    species.set(hunterId, rng.pick(HUNTER_SPECIES));
  }

  return clientIds.map((id) => {
    const isHunter = id === hunterId;
    const sp = species.get(id)!;
    return {
      clientId: id,
      role: isHunter ? Role.Hunter : Role.Survivor,
      species: sp,
      // The hunter never carries a weakness — it is the one asymmetry the
      // hunter gets in exchange for being outnumbered.
      weakness: isHunter ? null : rollWeakness(sp, rng),
    };
  });
}

/** Build the private role card shown on the intro screen. */
export function buildRoleCard(assignment: RoleAssignment): RoleCard {
  const animal = ANIMALS[assignment.species];
  if (assignment.role === Role.Hunter) {
    return {
      role: Role.Hunter,
      species: assignment.species,
      weakness: null,
      title: 'YOU ARE THE HUNTER',
      subtitle: `You are a ${animal.name}. So are dozens of animals out there.`,
      objective:
        'Blend in with your own kind. Find the animals that move like people. Kill as many as you can before the night ends.',
    };
  }
  const weakness = assignment.weakness ? WEAKNESSES[assignment.weakness] : null;
  return {
    role: Role.Survivor,
    species: assignment.species,
    weakness: assignment.weakness,
    title: 'YOU ARE PREY',
    subtitle: `You are a ${animal.name}. One of the animals out there is a player, and it is hunting you.`,
    objective: weakness
      ? `Survive ten minutes. Whistle every minute. ${weakness.emoji} ${weakness.name}: ${weakness.description}`
      : 'Survive ten minutes. Whistle every minute. Behave like an animal.',
  };
}

// ---------------------------------------------------------------------------
// Phase progression
// ---------------------------------------------------------------------------

/** Can a round start with this many connected players? */
export function canStart(playerCount: number): boolean {
  return playerCount >= MIN_PLAYERS;
}

export function beginIntro(round: Round): void {
  round.phase = RoundPhase.Intro;
  round.phaseTimer = ROUND_INTRO_DURATION;
  round.elapsed = 0;
  round.result = null;
}

export function beginPlaying(round: Round): void {
  round.phase = RoundPhase.Playing;
  round.phaseTimer = ROUND_DURATION;
  round.elapsed = 0;
}

export function beginRoundOver(round: Round, result: RoundResult): void {
  round.phase = RoundPhase.RoundOver;
  round.phaseTimer = ROUND_OVER_DURATION;
  round.result = result;
}

export function returnToLobby(round: Round): void {
  round.phase = RoundPhase.Lobby;
  round.phaseTimer = 0;
  round.elapsed = 0;
  round.hunterClientId = null;
  round.result = null;
}

/** Has the round's win condition been met? */
export function checkEndCondition(
  round: Round,
  players: PlayerActor[],
): { ended: boolean; winner: Winner } {
  if (round.phase !== RoundPhase.Playing) return { ended: false, winner: Winner.Draw };

  const survivors = players.filter((p) => p.role === Role.Survivor && p.connected);
  const alive = survivors.filter((p) => p.health > 0);
  const hunter = players.find((p) => p.role === Role.Hunter);

  // Time ran out: the survivors held on.
  if (round.phaseTimer <= 0) {
    // A hunter who cleaned up most of the lobby still gets the win nod.
    if (survivors.length > 0 && alive.length === 0) return { ended: true, winner: Winner.Hunter };
    return { ended: true, winner: alive.length > 0 ? Winner.Survivors : Winner.Draw };
  }

  // Everybody is dead: the hunter wins early.
  if (survivors.length > 0 && alive.length === 0) {
    return { ended: true, winner: Winner.Hunter };
  }

  // The hunter died (starvation, an AI jaguar, a very committed capybara).
  if (hunter && hunter.health <= 0) {
    return { ended: true, winner: Winner.Survivors };
  }

  // Everyone disconnected.
  if (survivors.length === 0 && !hunter) {
    return { ended: true, winner: Winner.Draw };
  }

  return { ended: false, winner: Winner.Draw };
}

// ---------------------------------------------------------------------------
// The reveal
// ---------------------------------------------------------------------------

/** Assemble the round-over payload, including the joke awards. */
export function buildResult(
  round: Round,
  players: PlayerActor[],
  winner: Winner,
): RoundResult {
  const hunter = players.find((p) => p.role === Role.Hunter) ?? null;
  const survivors = players.filter((p) => p.role === Role.Survivor);
  const alive = survivors.filter((p) => p.health > 0);
  const nameOf = (id: number): string | null => {
    const p = players.find((q) => q.id === id);
    return p ? p.name : null;
  };

  const reveals: PlayerReveal[] = players.map((p) => ({
    clientId: p.clientId,
    name: p.name,
    role: p.role,
    species: p.species,
    weakness: p.weakness,
    survived: p.health > 0,
    survivedSeconds: p.stats.survivedSeconds,
    kills: p.stats.kills,
    mealsEaten: p.stats.mealsEaten,
    whistles: p.stats.whistles,
    killedBy: p.killerId ? nameOf(p.killerId) : null,
  }));

  return {
    winner,
    hunterName: hunter?.name ?? 'Nobody',
    hunterSpecies: hunter?.species ?? Species.Crocodile,
    hunterKills: hunter?.stats.kills ?? 0,
    hunterMissed: hunter?.stats.missedAttacks ?? 0,
    hunterBestKill: hunter?.stats.bestKill ?? null,
    survivorsAlive: alive.length,
    survivorsTotal: survivors.length,
    reveals,
    awards: buildAwards(players),
    durationPlayed: round.elapsed,
  };
}

/**
 * The funny statistics.
 *
 * These matter more than they look: they are what turns a loss into a story,
 * and "MÉG EGYET!" — one more round — comes from the awards screen, not from
 * the win/lose line.
 */
export function buildAwards(players: PlayerActor[]): Award[] {
  const awards: Award[] = [];
  if (players.length === 0) return awards;

  /** Pick the player maximising a metric, if any player scores above zero. */
  const best = (
    metric: (p: PlayerActor) => number,
    minimum = 0.0001,
  ): PlayerActor | null => {
    let winner: PlayerActor | null = null;
    let bestValue = minimum;
    for (const p of players) {
      const v = metric(p);
      if (v > bestValue) {
        bestValue = v;
        winner = p;
      }
    }
    return winner;
  };

  const add = (
    emoji: string,
    title: string,
    p: PlayerActor | null,
    detail: (p: PlayerActor) => string,
  ) => {
    if (p) awards.push({ emoji, title, playerName: p.name, detail: detail(p) });
  };

  add('🏃', 'Longest Escape', best((p) => p.stats.longestEscape), (p) =>
    `${p.stats.longestEscape.toFixed(1)}s with something on their tail`,
  );

  add('🪰', 'Most Suspicious Animal', best((p) => p.stats.timeWithFlies), (p) =>
    `${Math.round(p.stats.timeWithFlies)}s covered in flies and still alive somehow`,
  );

  add('🍖', 'Most Food Eaten', best((p) => p.stats.mealsEaten), (p) =>
    `${p.stats.mealsEaten} meals — genuinely just here for the buffet`,
  );

  const croc = best((p) =>
    p.species === Species.Crocodile || p.species === Species.Caiman
      ? p.stats.distanceTravelled
      : 0,
  );
  add('🐊', 'Most Chaotic Crocodile', croc, (p) =>
    `${Math.round(p.stats.distanceTravelled)}m of pure reptilian nonsense`,
  );

  add('🦥', 'Slowest Player', best((p) => p.stats.timeStill), (p) =>
    `${Math.round(p.stats.timeStill)}s of doing absolutely nothing`,
  );

  const worstShot = best((p) => (p.role === Role.Hunter ? p.stats.missedAttacks : 0));
  add('🎯', 'Worst Hunter Shot', worstShot, (p) =>
    `${p.stats.missedAttacks} missed lunges. The jungle will remember.`,
  );

  add('🪈', 'Most Enthusiastic Whistler', best((p) => p.stats.whistles), (p) =>
    `${p.stats.whistles} whistles. Nobody asked for that many.`,
  );

  add('💦', 'Most Waterlogged', best((p) => p.stats.timeInWater), (p) =>
    `${Math.round(p.stats.timeInWater)}s spent as a floating snack`,
  );

  add('😱', 'Closest Calls', best((p) => p.stats.timesNearlyCaught), (p) =>
    `${p.stats.timesNearlyCaught} times within biting distance`,
  );

  const marathon = best((p) => p.stats.distanceTravelled);
  add('🧭', 'Jungle Marathon', marathon, (p) =>
    `${Math.round(p.stats.distanceTravelled)}m covered. Did you ever hide?`,
  );

  return awards;
}

/** Nutrition tier label used by the "best hunt" line. */
export function describeKill(species: Species | null): string {
  if (!species) return 'Nothing at all';
  const def = ANIMALS[species];
  const impressive = def.size >= SizeClass.Large ? ' (a big one)' : '';
  return `${def.emoji} ${def.name}${impressive}`;
}

/** Headline text for the round-over screen. */
export function winnerHeadline(winner: Winner): { title: string; subtitle: string } {
  switch (winner) {
    case Winner.Survivors:
      return {
        title: 'THE JUNGLE HELD',
        subtitle: 'The night came and went, and most of you are still breathing.',
      };
    case Winner.Hunter:
      return {
        title: 'THE HUNTER WINS',
        subtitle: 'It was standing next to you the whole time.',
      };
    default:
      return { title: 'ROUND OVER', subtitle: 'Nobody is quite sure what happened.' };
  }
}
