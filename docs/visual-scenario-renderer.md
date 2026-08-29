# Session spec: visual scenario renderer

Goal: eyeball hex-grid cases (coverage, paths, obstacles) as an SVG image with
near-zero code. Not a test assertion tool — that is a separate ASCII-matcher
session.

## Scope

**In:** a shared `Scenario` model, a pure `renderScenario(scenario) -> string`
SVG renderer, a `writeScenario(name, scenario)` helper that drops files during
`npm test`.

**Out (defer):** coord labels, legend, flat-top orientation, dark mode,
ring+core overlap rendering, interactive playground, dot renderer, promoting
pixel math to a public `src/layout.ts`.

## Files

```
src/test-utils/scenario.ts          Scenario model + HexStatus  (shared, do first)
src/test-utils/render-scenario.ts   renderScenario()
src/test-utils/write-scenario.ts    writeScenario() + auto index.html
src/<name>/<name>.visual.test.ts    per-utility hand-authored scenarios
```

Test-only code — not re-exported from `src/index.ts`. `scenarios/` is gitignored.

## 1. Shared model — `scenario.ts`

```ts
import type { Cube } from "../coordinates.js";

export type HexStatus =
  | "empty" | "obstacle" | "player" | "goal" | "reachable" | "path";

export interface Scenario {
  radius: number;              // draw the full hex disc of this radius
  title?: string;
  obstacle?: Iterable<Cube>;
  player?: Iterable<Cube>;
  goal?: Iterable<Cube>;
  reachable?: Iterable<Cube>;
  path?: Iterable<Cube>;       // ordered; also drawn as a connecting line
}
```

Author scenarios from real output:

```ts
const origin = cube(0, 0, 0);
const walls = [cube(1, -1, 0), cube(1, 0, -1)];
const s: Scenario = {
  radius: 4,
  player: [origin],
  obstacle: walls,
  reachable: reachableCubes(origin, 3, walls),
};
```

## 2. Renderer — `render-scenario.ts`

```ts
export interface RenderOptions {
  size?: number;   // center -> corner px, default 26
}
export function renderScenario(s: Scenario, opts?: RenderOptions): string;
```

Rules:

- **Pointy-top only.** Cube -> axial: `q = x`, `r = z`.
  ```
  px = size * sqrt(3) * (x + z / 2)
  py = size * 1.5 * z
  ```
- Board disc: `x` in `-radius..radius`, `y` in
  `max(-radius, -x-radius) .. min(radius, -x+radius)`, `z = -x - y`.
- One `<polygon>` per hex, 6 corners, 1px `#999` stroke.
- **Fill = single highest-priority status** the hex belongs to:
  `player > goal > path > obstacle > reachable > empty`.
- Palette:
  | status | color |
  | --- | --- |
  | empty | `#e8e8e8` |
  | reachable | `#bcd8ff` |
  | obstacle | `#4a4a4a` |
  | path | `#ff8c00` |
  | goal | `#2ecc71` |
  | player | `#d33` |
- If `path` has 2+ hexes, add one `<polyline>` through their centers,
  `stroke #ff8c00`, width 3, `pointer-events="none"`.
- `viewBox` from the pixel extent + `size` padding. `.toFixed(2)` all numbers
  so output is deterministic.
- Optional `title` as a `<text>` at top-left.
- Zero dependencies. String concatenation, no DOM.

## 3. Writer — `write-scenario.ts`

```ts
export function writeScenario(name: string, s: Scenario, opts?: RenderOptions): string;
```

- `mkdirSync("scenarios", { recursive: true })`, write `scenarios/<name>.svg`,
  return the SVG string.
- Module-level `afterAll` (from `vitest`): write `scenarios/index.html` — a
  flex-wrap gallery of `<figure><figcaption>name</figcaption><img src="name.svg"></figure>`
  for every name written this run. Idempotent; rewriting per test file is fine.
- Always writes (no env gating — a few small SVGs cost milliseconds and the dir
  is gitignored).

## 4. `.gitignore`

Add `/scenarios/`.

## 5. Tests — `visual.test.ts`

Hand-author scenarios that feed `reachableCubes` output into `writeScenario`:
open flood fill, flood around a single pillar, flood blocked by a wall line,
`steps = 0`, origin surrounded (result = origin only). These double as smoke
tests for `reachableCubes`; assert with `.toHaveLength(...)` where cheap.

## Done when

- `npm run typecheck && npm test` pass.
- `scenarios/index.html` opens in a browser / VS Code preview and shows the
  cases clearly.
- README gains a 3-line "Visual scenarios" section pointing at
  `scenarios/index.html`.

## Later upgrades (same model, no rework)

- Coord labels + legend behind an option.
- Dot renderer (`<circle>` at centers) as an alternative to polygons.
- Ring+core rendering for hexes with both a region and a marker status.
- Interactive `playground/index.html` once `distance` / `pathfind` exist.
