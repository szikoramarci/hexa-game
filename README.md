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

```
src/
  coordinates.ts        Cube type, constructor, validation, vector math, directions
  movement.ts           reachableCubes — BFS flood fill within a step budget
  pixel-range.ts        pixelRangeCubes — hexes whose centre falls in a pixel circle
  line-coverage.ts      lineCoverageCubes — every hex a centre-to-centre segment crosses
  index.ts              public exports
```

`lineCoverageCubes(start, end)` is the *supercover* line: every hex whose closed
hexagon the segment between the two centres touches. Crossing a shared edge
returns both hexes; running along one returns both. Wider than a lerp-and-round
line.

`pixelRangeCubes(center, range)` selects hexes by Euclidean distance between
pixel centres rather than hex steps, so the region is a rounded hexagon that
bulges past the hex-distance disc as `range` grows. `range` is in adjacent-hex
spacings: `1` reaches the six neighbours.

## Visual scenarios

`npm test` renders hand-authored hex cases (coverage, paths, obstacles) to
`scenarios/*.svg` plus a `scenarios/index.html` gallery — open it in a browser or
VS Code preview to eyeball them. Test-only; the directory is gitignored.

Each utility gets its own scenario package: `src/<name>.visual.test.ts`, writing
`<name>-<case>.svg`. The gallery scans the whole `scenarios/` folder and groups
by package, so every utility's cases show up together after one `npm test`.
Shared code lives in `src/test-utils/` (`scenario.ts`, `render-scenario.ts`,
`write-scenario.ts`).

## Adding a utility (per session)

1. One concern per file: `src/<name>.ts` + `src/<name>.test.ts`.
2. Pure functions. Take `Cube`, return new values — never mutate inputs.
3. Build on `coordinates.ts` primitives; don't re-derive them.
4. Re-export from `src/index.ts`.
5. `npm run typecheck && npm test` must pass.

### Planned utilities

- `distance` — cube distance between two hexes
- `neighbors` — adjacent hexes (via `CUBE_DIRECTIONS`)
- `range` / `ring` / `spiral` — hexes within N steps
- ~~`pixel-range`~~ — hexes whose centre falls in a pixel circle *(done)*
- ~~`line-coverage`~~ — every hex a centre-to-centre segment crosses (supercover) *(done)*
- `line` — single-width hexes on a straight line (lerp + cube rounding)
- `rotate` / `reflect` — symmetry operations
- `pathfind` — A* over a passability predicate
- `layout` — cube ↔ pixel for a lightweight visual check
