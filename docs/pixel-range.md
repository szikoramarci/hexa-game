# Session spec: pixel range

Goal: hexes whose **centre point** falls inside a circle around another hex's
centre. Unlike hex-distance range (a hexagonal disc), this is a Euclidean ball
in pixel space — a rounded region that bulges past the hex disc at edge
midpoints as the radius grows.

## Scope

**In:** one pure function `pixelRangeCubes(center, range)` in `src/pixel-range.ts`,
its tests, and a `src/pixel-range.visual.test.ts` scenario package.

**Out (defer):** flat-top orientation, a `size` / real-pixel parameter, ring /
annulus variants, promoting the pixel math to a public `src/layout.ts`.

## Function — `pixel-range.ts`

```ts
export function pixelRangeCubes(center: Cube, range: number): Cube[];
```

- `range` is measured in **adjacent-hex spacings**: `range = 1` reaches exactly
  the six immediate neighbours (their centres lie one spacing away). Fractional
  values are allowed; `range = 0` returns just `center`.
- Throws `RangeError` if `range` is negative, `NaN`, or infinite.
- Pointy-top pixel centre (unit size, matches the scenario renderer):
  `px = sqrt(3) * (x + z / 2)`, `py = 1.5 * z`. Neighbour spacing is `sqrt(3)`.
- A hex is included iff `hypot(dpx, dpy) <= range * sqrt(3)` within a `1e-9`
  tolerance (so the boundary six at `range = 1` land reliably).
- Search the cube disc of radius `ceil(2 * range) + 2` around `center` (any
  included hex is within cube distance `2 * range`), test each centre.
- Result ordered by increasing pixel distance from `center`, ties broken by
  `cubeKey` for determinism. `center` is always first.
- Pure; builds on `coordinates.ts`. Never mutates inputs.

## Tests — `pixel-range.test.ts`

- `range = 0` → `[center]`.
- `range = 1` → the 7 hexes of `reachableCubes(center, 1)` (origin + six
  neighbours), no more.
- `range = 2` → the full 19-hex disc through ring 2 (every ring-2 hex centre is
  within 2 spacings), nothing from ring 3.
- Large `range` (e.g. 8): result is a strict superset of the hex-distance disc
  of radius 8, and includes at least one ring-9 hex near an edge midmid — the
  bulge that distinguishes this from hex range.
- Ordered by non-decreasing pixel distance.
- Works away from the centre (`center = cube(4, -1)`), same count as at origin.
- Rejects negative / `NaN` / `Infinity`.

## Visual — `pixel-range.visual.test.ts`

Write `pixelrange-<case>.svg` via `writeScenario`, `player: [center]`,
`reachable: pixelRangeCubes(...)`:

- `r2`, `r4` — small radii, near-identical to a hex disc.
- `r8` — roundness clearly visible.
- `r8-vs-hex` — same board, `obstacle` = the hex-range ring at distance 8 so the
  pixel-range bulge shows against it (abuse of the `obstacle` colour purely for
  contrast; note it in the title).
- `offset` — non-origin centre.

## Done when

- `npm run typecheck && npm test` pass.
- `pixelRangeCubes` re-exported from `src/index.ts`.
- `scenarios/index.html` shows a `pixelrange` section with the rounding visible.
- README "Layout" + "Planned utilities" updated.
