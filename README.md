# hexa-game

Utility library for a hex-grid boardgame simulator. Small, single-purpose,
pure functions — each with its own tests.

## Coordinate system

Cube coordinates: every hex is `(x, y, z)` with `x + y + z = 0`. The board
centre is `(0, 0, 0)`. Reference: [Red Blob Games — Hexagons](https://www.redblobgames.com/grids/hexagons/).

`Cube` is a plain `readonly { x, y, z }` object. Use `cube(x, y, z?)` to build one
(derives `z` and validates the constraint).

## Stack

- Strict TypeScript, ESM only, built with `tsc` → `dist/`
- Vitest for tests
- No runtime dependencies

## Scripts

| Command | Purpose |
| --- | --- |
| `npm test` | Run all tests once |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` | Emit `dist/` |

## Layout

One folder per utility, holding its impl, unit test, and visual test:

```
src/
  coordinates/    Cube type, constructor, validation, vector math, directions
  dice/           seeded PRNG — seedRng / rollDie / rollDice, fully replayable
  distance/       cubeDistance — step count between two hexes
  layout/         cubeToPixel / pixelToCube / cubeRound — pointy-top pixel map
  movement/       reachableCubes — BFS flood fill within a step budget
  pixel-range/    pixelRangeCubes — hexes whose centre falls in a pixel circle
  line-coverage/  lineCoverageCubes — every hex a centre-to-centre segment crosses
  loose-ball/     looseBall — d6 direction + d6 distance scatter, first player stops it
  foul/           resolveFoul — d6 injury vs resilience + d6 card vs referee leniency
  pathfind/       pathCubes — shortest obstacle-free hex path (A*)
  arrow/          hexArrow — styled SVG arrow through a list of hex centres
  move-piece/     movePiece — constant-speed hex→hex animation plan (slide / jump)
  move-action/    the movement action — reachable + aim + walk, as pure state
  pass-action/    the ground pass — kick range, opponent shadow, interception roll
  test-utils/     shared scenario renderer + interactive playgrounds
  index.ts        public exports
```

`move-action` is the first **action** — it composes the utilities into "pick a
piece, see where it can go, aim, walk it there". Either call the pieces directly
(`reachableForPiece`, `movePath`, `moveArrow`, `pathHazards`, `applyMove`) or
feed the event reducer (`initMoveAction` / `moveAction(snap, event)` /
`moveView`) UI events (`selectPiece`, `hoverHex`, `commit`, `advance`, `cancel`)
and let it walk `idle → aiming → moving → (spent | stopped)`. `moveView().step`
hands you one hex segment at a time, so the piece steps through every hex of the
path, not start-to-end. If the **ball carrier** *steps into* an opponent's
influence (a hex next to an enemy piece — not merely staying in it) a `d6` is
rolled per opponent freshly entered; a `1` and the ball changes hands and the
move ends (`stopped`). Rolls come from the seeded `dice` PRNG in the snapshot,
so a game replays. Pure; no DOM, no timers, no rendering. See
`docs/move-action.md`.

A defender that can reach the enemy carrier's hex within its budget may
`tackle` instead: it lunges (`tackling`), spends all its points, and a
`d6 + tackling` vs `d6 + dribbling` challenge (`resolveChallenge`) decides the
ball. A defender `1` is a **foul**: `resolveFoul` rolls a `d6` injury check
against the carrier's `resilience` (a hit costs 2 move points, and sticks) and a
`d6` card check against `state.refereeLeniency` (`3..6`, default `4`; a second
yellow is a red — game stopped). The attacking side then picks `foulDecision`
play-on / stop; the free kick / penalty itself is still a `TODO`. Equal scores a
**loose ball** — `looseBall(rng, origin, stoppers)` rolls a `d6` direction and a
`d6` distance and scatters the ball in a straight line from the carrier's hex;
the first player on the line catches it, otherwise it rests loose where it stops
(field edges / goals deferred). On a win the winner's controller `relocate`s the
carrying piece (`relocationOptions` — free hexes around the other player) or
`cancel`s to the fallback spot. See `docs/tackle-action.md` + `docs/foul.md` +
`docs/loose-ball.md`.

`pass-action` is the **ground pass** — a sibling action to `move-action` that
reuses its `MoveActionState` / `Piece` / `ballCarrier` / `influencers`. Direct
fns (`passTargets`, `passLane`, `passBlocked`, `canPass`, `passInterceptors`,
`passThreats`, `passArrow`, `applyPass`) or the event reducer (`initPassAction` /
`passAction(snap, event)` / `passView`) over
`idle → aiming → passing → (received | loose | intercepted)` with events
`selectPiece` (the carrier only) / `hoverHex` / `commit` / `advance` / `cancel`.
The kick range is `pixelRangeCubes(carrier.at, state.passRange ?? 4)`; a target
is dropped when the straight `lineCoverageCubes` lane to it covers an
**opponent** (its **shadow** — teammates and obstacles never block). As the ball
rolls the lane, each opponent whose influence covers a flight hex rolls one
`d6` the first time the ball comes adjacent; a roll `>= state.interceptOn ?? 6`
picks the pass off and the ball stops on that opponent. Clear to the target: a
piece there receives it, otherwise it rests loose. Seeded, replayable, pure. See
`docs/pass-action.md`.

`cubeToPixel(c, size?)` / `pixelToCube(px, py, size?)` are the one pointy-top
layout map (`px = size·√3·(x + z/2)`, `py = size·1.5·z`, default `size` 26) —
the renderer, `hexArrow` and the playground all share it. `cubeRound` snaps a
fractional cube to the nearest hex. `cubeDistance(a, b)` is `(|dx|+|dy|+|dz|)/2`.

`looseBall(rng, origin, stoppers, die?)` scatters a drawn challenge's ball: a
`d6` picks one of the six hex directions, a `d<die>` (default 6) the distance,
and the ball rolls that straight line from `origin`. The first `BallStopper` on
the line stops it (`caughtBy`); `origin` itself never does. Returns the full
`route`, the `rest` hex and the advanced `rng`. Pure and replayable.

`lineCoverageCubes(start, end)` is the *supercover* line: every hex whose closed
hexagon the segment between the two centres touches. Crossing a shared edge
returns both hexes; running along one returns both. Wider than a lerp-and-round
line.

`pixelRangeCubes(center, range)` selects hexes by Euclidean distance between
pixel centres rather than hex steps, so the region is a rounded hexagon that
bulges past the hex-distance disc as `range` grows. `range` is in adjacent-hex
spacings: `1` reaches the six neighbours.

`pathCubes(start, end, obstacles?)` runs A* on the 6-neighbour grid (unit step
cost, cube-distance heuristic) and returns the shortest path from `start` to
`end` — both endpoints included — that never enters an obstacle, or `null` when
an endpoint is walled off. Obstacles on `start` / `end` are ignored. Output is
deterministic for equal-length ties.

`movePiece(start, end, options?)` returns an animation *plan* — not an
animation — for carrying a piece (any element centred on its local origin)
between two hex centres. Duration is `hexes ** falloff / speed`: `speed`
calibrates a 1-hex step and `falloff` (default `0.65`) makes longer moves
accelerate so they still feel snappy (`falloff: 1` → strictly constant speed).
`mode: "jump"` keeps the straight slide but scales up to `jumpPeak` at the apex
and back to `1` on landing. `moveKeyframes(plan)` samples it into
`element.animate(...)`-ready keyframes (CSS `transform`, so give an SVG element
`transform-box: fill-box; transform-origin: center`). Pure and deterministic.

`hexArrow(hexes, style?)` returns an SVG `<g>` fragment for a rendered board
(same pointy-top pixel map). `shape` sets the meaning: `straight` and 3+-hex
`curved` are **routes** running through every hex centre; a 2-hex `curved` arrow
is a **jump** — an arc leaving the board and landing again, over a faint ground
chord with a vertical apex tick (`bow` = hop height). `weight` (`thin` /
`normal` / `thick`), `dash` (`solid` / `dashed`), `color` and `size` are
orthogonal. Scenarios carry arrows via the `arrows` field.

## Visual scenarios

`npm test` renders hand-authored hex cases to `scenarios/` (test-only, gitignored).
Open `scenarios/index.html` in a **real browser** — it's a nav landing page:

```
scenarios/
  index.html                     nav: "Utility methods" + "Actions"
  utilities/<name>/index.html     one utility's static SVG cases
  actions/<name>/index.html       one action, all cases on one interactive page
```

Each utility gets a scenario package `src/<name>/<name>.visual.test.ts` calling
`writeScenario("<name>", "<case>", scenario)`. Pages rebuild from disk each run,
aggregating across the parallel vitest workers.

**Actions** are interactive single-page playgrounds:

- `actions/movement/index.html` — click a piece to select it, hover a reachable
  hex for the move arrow, click to walk it through every hex of the path;
  obstacles and other pieces block. Ball cases add teams + a stealable ball:
  hovering a route past a defender pulses the risky hexes red and the carrier
  shivers, and walking it rolls the steal check. A selected defender that can
  reach the enemy carrier (glowing red) clicks it to **tackle** — the challenge
  resolves and the winner clicks a green hex to reposition, or **stay**. A
  defender `1` is a **foul**: the injury + card `d6`s roll, an injured carrier
  glows and loses 2 move points, a booked fouler gets a card marker (a second
  yellow sends him off), then **play on** / **stop** buttons take the attacking
  side's call. A tied tackle **spills the ball**: a slate arrow shows the
  `d6`/`d6` scatter and the ball rolls along it until a player pounces or it
  comes to rest loose. Each steal / tackle challenge logs its dice and a plain
  result under the board (*successful ball-steal*, *failed tackle*, *foul …
  injury … card …*, *loose ball … scatter …*). Cases
  are grouped into **Simple movement / Ball steal / Tackling / Loose ball**
  (jump nav up top); each dice case carries **seed chips** — one click jumps
  straight to that outcome (a stolen ball, a won tackle, a tie that spills), so
  the rare events don't need a hundred `shuffle`s. `reset` replays the current
  seed, `shuffle` rolls a fresh one. The chip seeds are resolved in the test by
  scanning them through the real `move-action` reducer, which the inline mirror
  matches. Authored in `src/movement/movement.playground.test.ts`; see
  `docs/movement-scenarios.md` + `docs/move-action.md` + `docs/tackle-action.md`
  + `docs/foul.md` + `docs/loose-ball.md`.
- `actions/passing/index.html` — click the piece on the ball to arm a pass;
  legal targets fill blue, the hexes an opponent's **shadow** blocks stay grey.
  Hover a target for the straight two-point arrow (it reddens and its lane hexes
  pulse when a defender flanks it); click to kick — the ball flies the straight
  arrow and each flanking opponent rolls one `d6` as it passes (a `6` picks it
  off), logged under the board. `reset` replays the seed, `shuffle` rolls a fresh
  one. The page bakes
  its geometry from the real `pass-action` module; authored in
  `src/pass-action/pass-action.playground.test.ts`, see `docs/pass-action.md`.
- `actions/move-piece/index.html` — click a hex to send the pieces (player disc,
  striped ball) there via `movePiece`; toggle ground / jump. Long moves stay
  snappy (they accelerate); a jump zooms up over the gap. Authored in
  `src/move-piece/move-piece.playground.test.ts`; see `docs/move-piece.md`.

Shared test-only code is in `src/test-utils/` (`scenario.ts`, `board.ts`,
`render-scenario.ts`, `write-scenario.ts`, `gallery.ts`, `movement-playground.ts`,
`piece-playground.ts`).

## Adding a utility (per session)

1. One concern per folder: `src/<name>/<name>.ts` + `src/<name>/<name>.test.ts`
   (+ optional `<name>.visual.test.ts`).
2. Pure functions. Take `Cube`, return new values — never mutate inputs.
3. Build on `coordinates/` primitives; don't re-derive them.
4. Re-export from `src/index.ts`.
5. `npm run typecheck && npm test` must pass.

### Planned utilities

- ~~`distance`~~ — cube distance between two hexes *(done)*
- ~~`dice`~~ — seeded, replayable dice rolls *(done)*
- `neighbors` — adjacent hexes (via `CUBE_DIRECTIONS`)
- `range` / `ring` / `spiral` — hexes within N steps
- ~~`pixel-range`~~ — hexes whose centre falls in a pixel circle *(done)*
- ~~`line-coverage`~~ — every hex a centre-to-centre segment crosses (supercover) *(done)*
- ~~`arrow`~~ — styled SVG arrow: route through hex centres, or a 2-hex jump arc *(done)*
- ~~`move-piece`~~ — constant-speed hex→hex animation plan, ground slide or zooming jump *(done)*
- ~~`move-action`~~ — the movement action: reachable + aim + walk + ball-steal, direct fns or event reducer *(done)*
- ~~`tackle`~~ — defender lunge onto the carrier + `d6 + attr` challenge, folded into `move-action` (`resolveChallenge`, `reachTackle`, relocation) *(done)*
- ~~`loose-ball`~~ — `looseBall` d6-direction / d6-distance scatter of a drawn challenge, wired into the tackle tie; goals + field edges deferred *(done)*
- ~~`foul`~~ — `resolveFoul` d6 injury (vs resilience) + d6 card (vs referee leniency), wired into the tackle foul branch; the free kick / penalty + advantage are TODO *(done)*
- ~~`pass-action`~~ — the ground pass: `pixelRangeCubes` kick range, opponent `lineCoverageCubes` shadow, one `d6` interception per flanking opponent; direct fns or event reducer, plus the `actions/passing` playground *(done)*
- `line` — single-width hexes on a straight line (lerp + cube rounding)
- `rotate` / `reflect` — symmetry operations
- ~~`pathfind`~~ — shortest obstacle-free hex path via A* *(done)*
- ~~`layout`~~ — cube ↔ pixel (`cubeToPixel` / `pixelToCube` / `cubeRound`) *(done)*
