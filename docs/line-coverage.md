# Session spec: line coverage

Goal: every hex a straight segment between two hex **centres** passes through —
the *supercover* line, not the lerp-and-round line. If the segment touches a
hex's edge (or just a corner) that hex counts as covered, so an edge crossing
yields **both** neighbouring hexes.

## Scope

**In:** one pure function `lineCoverageCubes(start, end)` in
`src/line-coverage.ts`, its tests, and a `src/line-coverage.visual.test.ts`
scenario package.

**Out (defer):** the rounded single-width `line` (one hex per step), flat-top
orientation, a thickness / radius parameter, blocking obstacles.

## Function — `line-coverage.ts`

```ts
export function lineCoverageCubes(start: Cube, end: Cube): Cube[];
```

- Returns every hex whose closed hexagon the segment `start`→`end` intersects.
  Grazing an edge or a corner counts (an edge crossing returns both hexes; a
  segment running along a shared edge returns both).
- `start === end` → `[start]`. Integer coordinates assumed.
- Ordered by the parameter `t ∈ [0,1]` at which the segment enters each hex;
  `start` is first. Ties broken by `cubeKey`.
- Pure; builds on `coordinates.ts`. Never mutates inputs.

### Method

The cube→pixel map is affine, so a straight segment in pixel space is a straight
segment in cube space — work in cube space directly, no pixel conversion.

For a point `p` on the plane, let `a = pₓ − p_y`, `b = p_y − p_z`,
`c = p_z − pₓ`. The closed hexagon of centre `C` (pointy-top, matching the
scenario renderer) is exactly

```
a ∈ [aC−1, aC+1]   b ∈ [bC−1, bC+1]   c ∈ [cC−1, cC+1]
```

with `aC = Cₓ − C_y` etc. Each bound is linear in `t`, so clip `t ∈ [0,1]`
against the six inequalities (Liang–Barsky style). The hex is covered iff the
clipped interval is non-empty within `1e-9` — that tolerance is what keeps edge
and corner grazes in. The surviving `lo` is the entry parameter used for
ordering.

Test the cube disc… actually just the cube bounding box of `start`/`end`
expanded by 1 (a covered hex centre is within `2/3` of the segment on every
axis).

## Tests — `line-coverage.test.ts`

- `start === end` → `[start]`.
- Adjacent hexes → exactly the two, `start` first (segment crosses one shared
  edge at its midpoint).
- Collinear centres `(0,0,0)`→`(3,0,-3)` → exactly the 4 hexes on that axis,
  nothing beside them (segment hits no grid corner, `y ≡ 0` misses them all).
- A segment that runs along a shared edge, e.g. `(0,0,0)`→`(2,-1,-1)`, returns
  both hexes flanking that edge.
- Every result hex actually intersects the segment (re-clip and check).
- Consecutive results have non-decreasing entry `t`.
- Symmetry: `lineCoverageCubes(a, b)` is `lineCoverageCubes(b, a)` as a set.
- Works away from the origin (`start = cube(5, -2)`).

## Visual — `line-coverage.visual.test.ts`

Write `linecoverage-<case>.svg` via `writeScenario`, `player: [start]`,
`goal: [end]`, `reachable: lineCoverageCubes(start, end)`, plus
`lines: [[start, end]]` for a thin black guide along the raw segment:

- `adjacent` — the two-hex minimum.
- `axis` — collinear centres, a clean straight run.
- `along-edge` — `(0,0,0)`→`(2,-1,-1)`, the doubled hexes along the shared edge.
- `steep` / `shallow` — two general diagonals at different slopes, rounding
  clearly visible.
- `offset` — non-origin endpoints.

## Done when

- `npm run typecheck && npm test` pass.
- `lineCoverageCubes` re-exported from `src/index.ts`.
- `scenarios/index.html` shows a `linecoverage` section.
- README "Layout" + "Planned utilities" updated.
