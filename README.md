# 🌴 Jungle Jukebox

A 3D multiplayer social-deduction survival game set in the Amazon rainforest.

Everyone is an animal. Hundreds of AI animals move around you that look and
behave exactly the same. One of the players is the **hunter** — also an animal,
also surrounded by its own kind. You have ten minutes.

And once a minute, you have to whistle.

---

## Running it

```bash
npm install

# Single player (a local authority runs in the browser tab)
npm run dev            # then open the printed URL

# Multiplayer
npm run server         # authority server on :8787
npm run dev            # then Multiplayer → Connect
```

Production build and preview:

```bash
npm run build
npm run preview        # serves the built client on :4173
```

There are **no binary assets**. Terrain, animals, props and every sound are
generated at runtime, so the install is small and the game loads immediately.

### Verifying

```bash
npm run verify           # typecheck + unit tests + production build
npm run smoke            # end-to-end WebSocket client against a running server
npm run preview & npm run verify:browser   # drives the real game in headless Chromium
```

`verify:browser` walks the menu → settings → lobby → role card → live round,
asserts on draw calls, animal counts, the HUD and the actual rendered pixels,
and writes screenshots to `screenshots/`.

---

## How it plays

| | |
|---|---|
| **Move** | `WASD`, `Shift` to sprint, `Space` to jump |
| **Whistle** | `Q` — **once a minute, or flies give you away** |
| **Eat** | Hold `E` |
| **Attack** | Left click — any animal can bite, but a herbivore's does little |
| **Ability** | `X` (species signature move) |
| **Climb** | `R` up, `F` down |
| **Submerge** | `C` (crocodiles, caimans) |
| **Listen** | `G` (hunter only) |
| **Look** | Move the mouse (click to capture the cursor) |
| **Debug overlay** | `F3` |

### The whistle

Every survivor must whistle at least once every 60 seconds. *When* is up to you.
Miss the deadline and flies begin to gather — first one or two, then a swarm. A
swarm of flies is the only thing in the jungle that unambiguously means "this
animal is a person".

The tension is symmetric on purpose:

- Whistling is **loud**. It tells anything nearby roughly where you are.
- Not whistling is **worse**. It eventually paints a permanent marker on you.

So the interesting decision is timing — do you whistle now, while a crocodile is
thirty metres away and might hear it, or do you hold on and risk the flies
arriving while it is still there?

### The hunter is an animal

The hunter is never a human with a rifle. It is a black caiman, a jaguar, an
anaconda, an ocelot — and the spawner guarantees a healthy population of AI
animals of that same species to hide among. It has no whistle obligation, no
weakness, a slight speed edge, and a slow, narrow, unforgiving bite.

What it does not have is any way of knowing which animal is a person. It has to
watch behaviour, listen for noises, read footprints, and pick its moment.

### Your secret weakness

Every survivor gets one random handicap, chosen to be anatomically plausible for
their species — a limp, a clouded eye, a fast metabolism, noisy footfalls. You
are told yours. **Nobody else is**, including the hunter, and it is never drawn
above your animal. The hunter has to work out from behaviour why that one
capybara is slightly slower than the others.

Weaknesses come in three rarity tiers. Rarer does not mean strictly worse — it
means it changes how you have to play the round.

### Behave like an animal

There is no disguise button. The AI animals wander a few metres, stop, look
around, graze, drift towards water, sleep once it gets dark. If you sprint in
straight lines and pivot instantly, you will be found.

The player and the AI run through **the same movement solver** and are drawn by
**the same model builder**, and a snapshot on the wire has an identical shape for
both. There is no code path that could make a player look different.

---

## Architecture

```
src/
  Systems/      Config (every tunable), seeded RNG, noise, spatial grid, locomotion
  World/        Terrain heightfield + river carving, prop scattering
  Animals/      Species table, food chain
  AI/           Animal behaviour, herds
  Gameplay/     Round flow, weaknesses, hunger, whistle/flies, random events
  Environment/  Weather and the march from afternoon to night
  Core/         Entity types, the authoritative Simulation
  Networking/   Protocol, transport-agnostic GameHost, WS + local transports
  Render/       Renderer, terrain mesh, water, sky, foliage, animals, effects
  Player/       Camera rig, input
  Hunter/       (hunter senses live in Simulation + Renderer)
  Audio/        Procedural WebAudio soundscape
  UI/           Menu, settings, lobby, HUD, role card, results
  Graphics/     Quality presets and individual settings
server/         Dedicated authority server (Node + ws)
tools/          Verification utilities
tests/          Headless simulation tests
```

Three decisions shape everything else:

**1. The simulation is headless and shared.** `Core/Simulation.ts` imports no
Three.js and no DOM. It runs on the Node server for real multiplayer and *also*
in the browser tab for single-player, via the same `GameHost`. Single-player is
not a special mode with its own rules — it is a one-client server. A bug that
only appears online is therefore almost always a networking bug rather than a
gameplay one.

**2. The client is told only what it could see.** Snapshots contain position,
species, facing, gait, visible flags and fly intensity — nothing else. No roles,
no weaknesses, no hunger, no whistle timers for anyone but yourself. Interest
management clips them to a radius, and fly swarms are distance-gated on the
server. A modified client can misdraw its own view but it cannot learn who the
hunter is, because that was never sent to it. There is a unit test asserting
this.

**3. The world is deterministic from a seed.** Terrain, rivers, and every prop
are pure functions of the seed, so the server and every client agree on the world
without shipping it over the wire.

One consequence worth naming: the local authority runs on its own fixed-rate
timer, not on the render loop. Stepping it from `requestAnimationFrame` couples
game time to frame rate, and on a slow machine the entire simulation runs in slow
motion — the eight second intro took nearly thirty, and it read as a hang. A
remote server keeps its own clock, so the local host has to as well, or the two
modes would not behave alike.

### Performance notes

- **Foliage** (~15k props) is chunked into a 10×10 grid with one `InstancedMesh`
  per (kind, chunk). A single map-wide InstancedMesh cannot be frustum-culled —
  its bounds cover everything — so chunking is what makes the jungle affordable.
  Wind is a vertex-shader displacement, so thousands of plants sway for free.
- **Animals** are pooled per species and per detail level, with the nearest few
  getting fully articulated models and the rest a simplified one. Anything past
  the view distance is not drawn at all.
- **AI** uses a spatial grid for neighbour queries, and animals far from every
  player tick at a fraction of the rate with a proportionally larger `dt`. A tick
  with ~190 animals and 8 players stays under a couple of milliseconds; there is
  a test that fails if it regresses.
- **Snapshots** are packed binary at 15 bytes per actor — about 3 KB for a busy
  jungle, ~13 KB/s per client measured end to end. JSON would have been ~15×
  that, plus parse garbage every frame.

Every gameplay constant lives in `src/Systems/Config.ts` — round length, whistle
interval, fly reveal time, hunger rates, hunter damage, AI population, weather
weights. Rebalancing does not require touching any system.

---

## What is implemented

- Procedural Amazon map: heightfield terrain, a meandering main river with
  tributaries, sunlit clearings, canopy, undergrowth, rocks, fallen logs,
  abandoned huts, rope bridges, cave mouths, lily pads, hanging vines
- 23 species defined, 19 active and 17 of those playable, each with its own
  speed, diet, hunger rate, locomotion (swim / climb / jump), silhouette,
  temperament and signature ability — all data in one table. The four flying
  species are withdrawn via an `enabled` flag rather than deleted, so the
  snapshot format's species indices stay stable
- Procedural animal models: ten body plans built from primitives, with a walk
  cycle that lifts each leg during its forward half, a distinct swimming motion
  (fishtail sway, roll and bob), head, tail and serpent undulation — all driven
  only from snapshot fields, so a player and an AI animate identically
- Per-instance colour variation on every plant, mottled terrain vertex colours,
  drifting falling leaves, water ripples that scale with how hard an animal is
  churning the surface, and a subtle colour grade
- AI with a weighted behaviour selector (wander, graze, drink, flee, hunt, rest,
  sleep, bask, follow, patrol, vocalise), herds, reaction delays, and
  day/night + weather-dependent behaviour
- Hunger and a real food chain: grazing, fruit bushes, fishing shoals, carrion,
  and hunting live prey
- The whistle/fly system, with distance- and weather-gated visibility
- 16 secret weaknesses with rarity tiers and per-species anatomical eligibility
- Hunter role dealing, natural-weapon attacks, and senses (listen, footprints,
  focus)
- Dynamic weather (clear / cloudy / rain / storm / fog) with lightning, and a
  round that always runs from mid-afternoon into full night
- 10 random events (flash flood, crocodile migration, parrot swarm, jaguar
  territory, fog, dead calm, …)
- Ten-minute rounds, win conditions, and a round-over reveal with hunter and
  survivor stats plus joke awards
- Multiplayer: dedicated server, rooms with shareable codes, lobby with species
  selection and ready states, private role cards
- Main menu over the live 3D world, LOW/MEDIUM/HIGH presets plus 19 individual
  graphics options, controls and how-to-play screens
- Fully procedural audio through a small algorithmic reverb: the signature
  whistle (a swoop, a vibrato sustain and a drop, pitched per player so people
  are distinguishable by ear), positional footsteps, fly buzz, rain, wind,
  river, insects, frogs, thunder, and a tension drone that rises as your
  whistle goes overdue
- An ambience director that scatters distant calls — macaws, howler troops,
  night birds, frogs — at irregular intervals from random directions, with the
  pool changing between day and night. A static ambience bed stops registering
  after a minute; the irregular punctuation is what makes a rainforest
  unmistakable

## Known gaps

Honest list of what a prototype this size does not have:

- **No client-side prediction.** Movement is server-authoritative and
  interpolated, so on a high-latency connection your own animal will feel
  slightly behind your input. Fine locally and on a LAN; the next thing to build
  for internet play.
- **Water reflections are a fresnel sky approximation**, not a real planar
  reflection pass — it reads as water but does not mirror the trees.
- **Ambient occlusion and motion blur are exposed as settings but not yet
  implemented** as post-processing passes; the toggles are wired through and
  currently no-ops.
- **No client-side reconciliation of the hunter's attack**, so a bite's visual
  and its result arrive one round trip apart.
- Practice bots in single-player wander and whistle roughly on time, which is
  enough to make solo hunting a real exercise, but they do not flee, feed, or
  react to being hunted. They are a target, not an opponent.
- The four flying species (macaw, harpy eagle, heron, fruit bat) are withdrawn.
  The flight model works but the body plan reads poorly in play, so they are
  disabled rather than shipped half-finished.
- Mouse sensitivity in the settings panel is displayed but not yet persisted.

## Licence

Unlicensed prototype.
