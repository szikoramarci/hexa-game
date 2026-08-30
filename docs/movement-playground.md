# Session spec: movement playground (first action layer)

Goal: the first *interactive* scenario — a piece you can move. Same generated
gallery as the static SVGs, but clickable hexes: hover a reachable hex to see a
dashed move arrow, click to walk the piece there hex-by-hex.

## Scope

**In:**
- `src/layout/` — `cubeToPixel` / `cubeRound` / `pixelToCube` (pointy-top,
  canonical version of the `toPixel` that was copied in `arrow.ts` +
  `render-scenario.ts`).
- `src/distance/` — `cubeDistance(a, b)`.
- `src/test-utils/board.ts` — shared `disc()` / `hexCorners()` geometry.
- `src/test-utils/gallery.ts` — `scenarios/` folder layout + page generation
  (landing nav, per-utility pages, action pages).
- `src/test-utils/movement-playground.ts` — `writeMovementPlayground(slug,
  label, blurb, cases)` → one self-contained interactive page at
  `scenarios/actions/<slug>/index.html`.
- `src/movement/movement.playground.test.ts` — the authored cases.

**Out (defer):** flat-top; multiple pieces / turns; enemy blocking; curved or
jump move arrows; a shared JS bundle instead of the small inline mirror; the
`line` utility (BFS gives the path here).

## `scenarios/` layout

```
scenarios/
  index.html                       landing — nav over "Utility methods" + "Actions"
  utilities/<slug>/index.html       one utility's SVG cases + _meta.json
  utilities/<slug>/<case>.svg
  actions/<slug>/index.html         one action, all cases on one page + _meta.json
```

`writeScenario(group, name, s)` writes under `utilities/<group>/`. Gallery pages
are rebuilt from disk on every write, so they aggregate across the parallel
vitest workers.

## Utilities

```ts
export function cubeToPixel(c: Cube, size?: number): { x: number; y: number };
export function cubeRound(x: number, y: number, z: number): Cube;
export function pixelToCube(px: number, py: number, size?: number): Cube;
export function cubeDistance(a: Cube, b: Cube): number;
```

- Pointy-top map: `px = size·√3·(x + z/2)`, `py = size·1.5·z`, default `size` 26.
- `cubeRound`: round each axis, correct the one with the largest delta so
  `x + y + z = 0`. `pixelToCube` = invert the map, then `cubeRound`.
- Pure, on `coordinates.ts`, never mutate. All four re-exported from
  `src/index.ts`. `pathfind.ts` / `arrow.ts` / `render-scenario.ts` and the
  visual tests refactored to consume them — no behaviour change.

## Generator — `movement-playground.ts`

```ts
interface MovementPlayground {
  radius: number;
  piece: { at: Cube; label: string | number };
  budget: number;
  obstacle?: Iterable<Cube>;
}
interface MovementCase { title: string; play: MovementPlayground; }

writeMovementPlayground(
  slug: string, label: string, blurb: string,
  cases: readonly MovementCase[], opts?: RenderOptions,
): string;
```

- One page, one `<section class="case" id="case-N">` per case: a baked board
  `<svg>` (real `cubeToPixel` / `disc` / `hexCorners`), each `<polygon>` with
  `data-key`; obstacles get the obstacle fill; a `<g class="piece">` circle +
  number; an empty `<g class="arrow-layer">`; a per-case `status` + `reset`.
- One inline `<script>`: a `CASES` manifest (`{id, data}` with `size`, `budget`,
  `origin`, `label`, `board`, `obstacles`) and `initCase(section, DATA)` — all
  DOM queries scoped to the section. It holds a mirror of `cubeToPixel` plus a
  **BFS flood** from the piece giving `dist` + a `cameFrom` tree (unit step cost
  ⇒ BFS parents are the shortest path, so this is `reachableCubes` + every path
  in one pass). Hover a reachable hex → dashed `<polyline>` + triangle head
  (the `straight` + `dashed` case of `hexArrow`); click → walk the piece along
  `pathTo` (~140 ms/hex), then re-flood from the new hex; reset restores.
- Palette matches the renderer. `.toFixed(2)`, zero deps, no `${`/backtick in
  the script string.

## Cases — `movement.playground.test.ts`

`open field 2-hex`, `open field 4-hex`, `one pillar`, `wall + one gap`,
`scattered obstacles`, `S-corridor` (budget 5). Tests: every case is on the
page; each has a non-empty reachable region; the inline BFS equals
`reachableCubes` clipped to the board.

## Later

The page grew teams, a ball, the steal check, the tackle, loose-ball scatter,
and the **foul** flow (injury + card + the play-on / stop decision — see
`docs/foul.md`). It is now split into four sections with per-case **seed
chips** — see `docs/movement-scenarios.md`.

## Done when

- `npm run typecheck && npm test` pass.
- `cubeToPixel` / `pixelToCube` / `cubeRound` / `cubeDistance` re-exported.
- `scenarios/index.html` lists every utility and the `piece movement` action;
  the action page shows all six boards; hover/click/reset work, obstacles block.
- README "Layout" + "Planned utilities" + "Visual scenarios" updated.
