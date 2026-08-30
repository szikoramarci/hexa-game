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
  pathfind/       pathCubes — shortest obstacle-free hex path (A*)
  arrow/          hexArrow — styled SVG arrow through a list of hex centres
  move-piece/     movePiece — constant-speed hex→hex animation plan (slide / jump)
  move-action/    the movement action — reachable + aim + walk, as pure state
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

`cubeToPixel(c, size?)` / `pixelToCube(px, py, size?)` are the one pointy-top
layout map (`px = size·√3·(x + z/2)`, `py = size·1.5·z`, default `size` 26) —
the renderer, `hexArrow` and the playground all share it. `cubeRound` snaps a
fractional cube to the nearest hex. `cubeDistance(a, b)` is `(|dx|+|dy|+|dz|)/2`.

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
  shivers, and walking it rolls the steal check. `reset` re-rolls the seed. The
  inline script mirrors the `move-action` reducer. Authored in
  `src/movement/movement.playground.test.ts`; see `docs/move-action.md`.
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
- `line` — single-width hexes on a straight line (lerp + cube rounding)
- `rotate` / `reflect` — symmetry operations
- ~~`pathfind`~~ — shortest obstacle-free hex path via A* *(done)*
- ~~`layout`~~ — cube ↔ pixel (`cubeToPixel` / `pixelToCube` / `cubeRound`) *(done)*
