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
  distance/       cubeDistance — step count between two hexes
  layout/         cubeToPixel / pixelToCube / cubeRound — pointy-top pixel map
  movement/       reachableCubes — BFS flood fill within a step budget
  pixel-range/    pixelRangeCubes — hexes whose centre falls in a pixel circle
  line-coverage/  lineCoverageCubes — every hex a centre-to-centre segment crosses
  pathfind/       pathCubes — shortest obstacle-free hex path (A*)
  arrow/          hexArrow — styled SVG arrow through a list of hex centres
  move-piece/     movePiece — constant-speed hex→hex animation plan (slide / jump)
  test-utils/     shared scenario renderer + interactive playgrounds
  index.ts        public exports
```

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

- `actions/movement/index.html` — hover a reachable hex for the dashed move
  arrow, click to walk the piece there hex-by-hex, obstacles block. Authored in
  `src/movement/movement.playground.test.ts`; see `docs/movement-playground.md`.
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
- `neighbors` — adjacent hexes (via `CUBE_DIRECTIONS`)
- `range` / `ring` / `spiral` — hexes within N steps
- ~~`pixel-range`~~ — hexes whose centre falls in a pixel circle *(done)*
- ~~`line-coverage`~~ — every hex a centre-to-centre segment crosses (supercover) *(done)*
- ~~`arrow`~~ — styled SVG arrow: route through hex centres, or a 2-hex jump arc *(done)*
- ~~`move-piece`~~ — constant-speed hex→hex animation plan, ground slide or zooming jump *(done)*
- `line` — single-width hexes on a straight line (lerp + cube rounding)
- `rotate` / `reflect` — symmetry operations
- ~~`pathfind`~~ — shortest obstacle-free hex path via A* *(done)*
- ~~`layout`~~ — cube ↔ pixel (`cubeToPixel` / `pixelToCube` / `cubeRound`) *(done)*
