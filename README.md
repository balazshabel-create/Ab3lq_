# JukeJungle

A 3D multiplayer social-deduction survival game set in the Amazon rainforest.

Everyone is an animal. Hundreds of AI animals move around you that look and
behave exactly the same. One of the players is the **hunter** — also an animal,
also surrounded by its own kind. You have ten minutes, inside a circle that
closes in every two of them.

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
| **Move** | `W` forward, `A`/`D` turn, `S` about-turn, `Shift` sprint, `Space` jump |
| **Whistle** | `Q` — **once a minute, or flies give you away** |
| **Eat** | Hold `E` |
| **Attack** | Left click — any animal can bite, but a herbivore's does little |
| **Ability** | `X` (species signature move) |
| **Climb** | `R` up, `F` down |
| **Submerge** | `C` — crocodilians only, and only in deep water |
| **Listen** | `G` (hunter only) |
| **Look** | Move the mouse — independently of where you are going |
| **Debug overlay** | `F3` |

### The camera does not steer you

`W` drives your animal along *its own* facing and `A`/`D` turn it. The mouse only
moves the camera. So you can look straight back over your shoulder to see what is
chasing you while still running away from it — which used to be impossible,
because "forward" meant "away from the camera" and glancing behind you turned the
animal round and ran it into the thing you were fleeing.

`S` turns you around and walks back the way you came, because animals reverse by
turning rather than by walking backwards.

How fast you turn is your species' business, not the input's: the client only
asks for a heading, and the movement solver enforces the animal's own agility (and
the Stiff Joints weakness) on the body.

### The mouse is captured automatically

Starting a round takes a **pointer lock**: the cursor is hidden and confined to
the window, and the mouse reports relative movement instead of a screen
position. That is the only mechanism that stops the pointer sliding onto a
second monitor mid-game — F11 cannot do it, because it is only a browser window
state and the mouse stays an ordinary desktop cursor.

The lock is taken on the click that starts the round, because a browser will only
grant it from a user gesture and the intro countdown would otherwise burn it. It
is held across the role card and the round itself. Pressing Escape releases it
and opens the settings panel (you need a cursor there); closing the panel takes
it straight back. Any click or keypress during a round re-acquires it if it was
somehow lost.

One honest limitation: inside an embedded iframe a cross-origin frame may be
refused the lock. When that happens the game says so rather than telling you to
keep clicking, and falls back to free-cursor look so it stays playable — open it
in its own tab for a captured cursor. Nothing a web page can do will confine a
*free* cursor.

### The storm circle

A circle is drawn somewhere random in the jungle when the round is dealt, and it
closes in every two minutes: 300 m down to 36 m over four shrinks, with the last
one held for the final minute. Outside it there is a wall of storm, continuous
lightning and tornadoes. The first ring does 2.4 %/s, so cutting a corner through
it to get back is a real and frightening option; the last does 20 %/s, which is
not an option at all.

It exists because hiding had a degenerate optimum. Walk to a far corner, stand in
a bush, wait out ten minutes — unbeatable, and extremely boring for the hider as
much as for the hunter. The circle removes the corner, and by the last stage
everyone still alive is in a clearing-sized space together, still pretending.

Every circle is guaranteed to contain river. A caiman with nowhere to swim cannot
hide, cannot feed and cannot use its ability, so the sequence is planned
*backwards* from the smallest ring — the endgame circle is chosen on water
deliberately, then the larger ones grow outwards around it.

The AI runs for the middle too, overriding even fleeing a predator. A crowd
standing placidly in a tornado would be a tell, and would make the wall read as
scenery rather than as weather.

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

### You do not choose your animal

Every round deals you a random species and there is no lobby control that
influences it. If players could pick they would, and they would pick the same
thing every time — eight capybaras that are all people means hiding among AI has
stopped meaning anything, and "that species is popular with humans" is a read no
amount of careful animal impersonation beats.

Being handed something unexpected is also the round's opening problem: you find
out you are a sloth and have to work out how a sloth survives. The lobby keeps
the full bestiary as a read-only reference so you can prepare for any of them.

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
  Gameplay/     Round flow, weaknesses, hunger, whistle/flies, storm zone, events
  Environment/  Weather and the march from afternoon to night
  Core/         Entity types, the authoritative Simulation
  Networking/   Protocol, transport-agnostic GameHost, WS + local transports
  Render/       Renderer, terrain, water, sky, foliage, streamed grass, backdrop,
                storm wall, animals, effects
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

- Procedural Amazon map, a kilometre across: heightfield terrain, a meandering
  main river with tributaries, sunlit clearings, canopy, undergrowth, rocks,
  fallen logs, abandoned huts, rope bridges, cave mouths, reeds at the waterline,
  weed on the river bed, lily pads, hanging vines
- A backdrop that continues the jungle past the playable edge out to a ring of
  mountains four kilometres away, so the world never visibly ends
- The shrinking storm circle, with a churning wall, drifting tornadoes and
  continuous lightning
- Dense streamed ground cover: grass generated on demand in chunks around the
  camera rather than scattered over the map, plus flowers in five colours
- Foliage built from leaf cards rather than spheres — trees have branches with
  leaf clusters hanging off them, bushes are leaves around stems, ferns are
  compound fronds with paired leaflets
- A post-processing chain: HDR render targets, bloom on genuine highlights only,
  SMAA, and tone mapping applied last
- Rain as slanted screen-space streaks that dimple the river where they land
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
- **Ambient occlusion and motion blur are still no-ops.** Bloom and SMAA now run
  in a real composer chain, but AO does not. Three's SSAO/GTAO passes re-render
  the scene with an overridden normal material, which would skip the wind
  displacement in the foliage vertex shaders — so the AO would be computed against
  geometry in the wrong place. Doing it properly means writing normals in the main
  pass, which has not been built.
- **No ray tracing and no frame generation.** Neither is available to a WebGL
  page: there is no ray-tracing API in the platform, and frame generation is a
  driver/vendor feature (DLSS, FSR) that a browser cannot reach. What the
  lighting actually is: one shadow-mapped directional sun on a tightened frustum,
  a hemisphere bounce term, a weak opposite-side fill, ACES tone mapping and a
  bloom pass. That is a long way from ray tracing and it is worth being straight
  about.
- **No client-side reconciliation of the hunter's attack**, so a bite's visual
  and its result arrive one round trip apart.
- Practice bots in single-player wander and whistle roughly on time, which is
  enough to make solo hunting a real exercise, but they do not flee, feed, or
  react to being hunted. They are a target, not an opponent.
- The four flying species (macaw, harpy eagle, heron, fruit bat) are withdrawn.
  The flight model works but the body plan reads poorly in play, so they are
  disabled rather than shipped half-finished.
- Mouse sensitivity in the settings panel is displayed but not yet persisted.
- Grass reaches 26 m and then stops. The cutoff is hard to see — a 15 cm tuft is
  a couple of pixels tall at that range — but it is a cutoff, not a fade.
- The four flying species remain withdrawn; see above.

## Licence

Unlicensed prototype.
