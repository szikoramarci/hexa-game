# Session spec: pathfind

Goal: the shortest hex path from `start` to `end` that never enters a blocked
hex — plain A* on the 6-neighbour grid, unit step cost.

## Scope

**In:** one pure function `pathCubes(start, end, obstacles?)` in
`src/pathfind/pathfind.ts`, its tests, and a `src/pathfind/pathfind.visual.test.ts`
scenario package.

**Out (defer):** weighted terrain / cost function, a passability *predicate*
instead of a hex list, diagonal or jump moves, flat-top orientation, returning
*all* shortest paths.

## Function — `pathfind.ts`

```ts
export function pathCubes(
  start: Cube,
  end: Cube,
  obstacles?: Iterable<Cube>,
): Cube[] | null;
```

- Returns the path **inclusive of both endpoints**, `start` first, each hex
  adjacent to the next, none blocked. Length is `cubeDistance + 1` when nothing
  is in the way.
- `start === end` → `[start]` (even if listed as an obstacle).
- No route (start or end fully walled off) → `null`.
- Obstacles equal to `start` or `end` are ignored — you may leave the hex you
  stand on and step onto the target. Duplicates tolerated.
- Deterministic: A* frontier ordered by `(f, h, cubeKey)`, neighbours generated
  in `CUBE_DIRECTIONS` order, so a tie between equal-length paths always resolves
  the same way.
- Pure; builds on `coordinates.ts`. Never mutates inputs. Fresh array.

### Method

A* with heuristic `h = cubeDistance(n, end) = (|dx|+|dy|+|dz|) / 2` — admissible
and consistent, so the first pop of `end` is optimal. `g` = steps from `start`.
Frontier is a small array scanned for the min each iteration (board-sized
inputs); `cameFrom` map rebuilds the path. Search terminates when the frontier
empties (a blocked-in region is finite) — no artificial node cap.

## Tests — `pathfind.test.ts`

- `start === end` → `[start]`; also when that hex is an obstacle.
- Adjacent hexes → exactly the two, `start` first.
- Open grid, collinear → the `cubeDistance + 1` hexes straight along the axis.
- Open grid, diagonal → length `cubeDistance + 1`, every step adjacent, `start`
  / `end` at the ends.
- A wall across the direct line → path routes around it, still contiguous and
  obstacle-free, length `> cubeDistance + 1`.
- Start ringed by six obstacles → `null`. End ringed → `null`.
- Obstacle on `start` or `end` (only) → still solved, endpoint appears in the
  path.
- Two gaps in a wall → picks the shorter detour.
- Symmetry: `pathCubes(a, b)` reversed has the same length as `pathCubes(b, a)`.
- Deterministic: same inputs → identical array.
- Does not mutate the inputs or the obstacle iterable.
- Works away from the origin.

## Visual — `pathfind.visual.test.ts`

Write `pathfind-<case>.svg` via `writeScenario`: `player: [start]`,
`goal: [end]`, `obstacle: <walls>`, `path: pathCubes(...) ?? []`, plus
`lines: [[start, end]]` for the straight reference chord.

- `open` — no obstacles, a clean diagonal run.
- `around-wall` — one straight wall between the endpoints, short detour.
- `two-gaps` — a long wall with two openings; the shorter one wins.
- `corridor` — an S-shaped passage the path threads.
- `maze` — a denser scatter of obstacles, path weaves through.
- `enclosed` — goal boxed in on all six sides: `path` empty, just the box.
- `offset` — endpoints and wall away from the origin.

## Done when

- `npm run typecheck && npm test` pass.
- `pathCubes` re-exported from `src/index.ts`.
- `scenarios/index.html` shows a `pathfind` section.
- README "Layout" + "Planned utilities" updated.
