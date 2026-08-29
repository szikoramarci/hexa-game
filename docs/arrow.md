# Session spec: arrow

Goal: an SVG arrow that runs through a list of hex **centres** and points at the
last one. A drawing helper for the visual layer — not a `Cube[]` utility.

`shape` carries meaning, not just looks:
- `straight` / `curved` with 3+ hexes — a **route** across the board, through
  every centre.
- `curved` with exactly 2 hexes — a **jump**: leaves the board at the start,
  arcs up over the gap, lands on the end hex. Drawn over a faint ground chord
  with a vertical apex tick for the hop height.

`weight` (thin / normal / thick), `dash` (solid / dashed) and `colour` are
orthogonal to that.

## Scope

**In:** one pure function `hexArrow(hexes, style?)` in `src/arrow/arrow.ts`
returning an SVG `<g>` fragment, its tests, `src/arrow/arrow.visual.test.ts`, and
an `arrows?` field on the `Scenario` model so scenarios can carry arrows.

**Out (defer):** flat-top orientation, labels along the arrow, double-headed or
tail decorations, gradient / animated strokes, `<marker>` defs (the head is a
plain polygon so output stays deterministic and self-contained).

## Function — `arrow.ts`

```ts
export type ArrowShape = "straight" | "curved";
export type ArrowWeight = "thin" | "normal" | "thick";
export type ArrowDash = "solid" | "dashed";

export interface ArrowStyle {
  shape?: ArrowShape;   // default "straight"
  weight?: ArrowWeight; // default "normal"
  dash?: ArrowDash;     // default "solid"
  color?: string;       // default "#ff8c00"
  size?: number;        // hex centre-to-corner px, default 26 (matches renderer)
  bow?: number;         // jump hop height, fraction of start->end distance, default 0.22
}

export function hexArrow(hexes: Cube[], style?: ArrowStyle): string;
```

- Needs **2+ hexes**; throws `RangeError` otherwise. Consecutive duplicate hexes
  are collapsed first; if fewer than 2 survive, throws.
- Pointy-top cube -> pixel, same map as the renderer:
  `px = size * sqrt(3) * (x + z / 2)`, `py = size * 1.5 * z`.
- **route** (`straight`, or `curved` with 3+ hexes): straight segments / a
  Catmull-Rom spline (`M ... C ...`, tangents clamped) through every centre.
- **jump** (`curved` with exactly 2 hexes, `bow != 0`): apex placed straight up
  (screen `-y`) from the chord midpoint by `bow` of the chord length, floored at
  `0.8 * size` for positive `bow`; spline through start -> apex -> end. Adds two
  faint (`stroke-opacity 0.4`) `<line>`s behind the shaft: the ground chord
  start->end, and a dashed vertical tick from the chord midpoint to the apex.
  `bow: 0` degrades to a plain 2-hex line (no chrome).
- The **tip sits exactly on the last hex's centre**. The shaft is pulled back by
  ~0.85 head-lengths so the stroke does not poke through the head.
- Arrowhead: a filled `<polygon>` triangle, tip at the last centre, oriented
  along the final tangent — for a jump this points *down* onto the target.
- Weight -> stroke width, scaled from `size`: thin `size*0.08`, normal
  `size*0.15`, thick `size*0.28`. Head length/width scale from the stroke.
- `dash: "dashed"` sets `stroke-dasharray` on the shaft (scaled from stroke); the
  head and the jump chrome are never affected.
- Output: `<g ...>[<line/><line/>]<path/><polygon/></g>`, `pointer-events="none"`,
  every number `.toFixed(2)` for deterministic strings. Zero deps, no DOM.
- Pure; builds on `coordinates.ts`. Never mutates inputs.

## Renderer integration — `test-utils/scenario.ts` + `render-scenario.ts`

```ts
export interface ArrowSpec extends ArrowStyle { hexes: Iterable<Cube>; }
// Scenario gains:  arrows?: ArrowSpec[];
```

`renderScenario` appends `hexArrow([...spec.hexes], spec)` for each entry, after
the polygons and the `path` polyline, passing the render `size` through as the
default when the spec omits it.

## Tests — `arrow.test.ts`

- Throws on `[]` and on a single hex; throws when duplicates collapse to one.
- Two hexes, straight: output contains one `<g>`, one `<path>`, one `<polygon>`;
  the path starts (`M`) at the first centre.
- The polygon's tip vertex equals the last hex's centre (within 0.01).
- `shape: "curved"` puts a `C` command in the path; straight does not.
- A 2-hex `curved` arrow is a jump: two `<line>`s (chord + apex tick), the arc
  rises above the ground (`min y` well negative, `max y` ~0), the tick is
  vertical. `bow` scales the hop height; `bow: 0` and 3+ hexes drop the chrome.
- `weight` changes `stroke-width` (thin < normal < thick); `size` scales it.
- `dash: "dashed"` adds `stroke-dasharray` to the path but not the polygon.
- `color` propagates to both stroke and polygon fill.
- Multi-hex (4+) straight path has one vertex per hex.
- Deterministic: same inputs -> identical string.
- Does not mutate the input array or its cubes.

## Visual — `arrow.visual.test.ts`

Write `arrow-<case>.svg` via `writeScenario`, using the new `arrows` field over a
plain disc with `player` at the start hex and `goal` at the end hex:

- `styles` — same 3-hex path drawn six times (one per shape x weight x dash
  combo of interest), stacked on offset rows or colour-coded, as a style sheet.
- `straight-multi` — a 5-hex zigzag, straight.
- `curved-multi` — the same 5 hexes, curved, so the smoothing is obvious.
- `thick-dashed` — a short thick dashed curved arrow.
- `turn` — a sharp 3-hex right-angle turn, straight vs curved side by side (two
  arrows, two colours, one scenario).
- `jump` — same two endpoints, no middle hexes: a straight route (walk) and a
  2-hex curved arrow (jump) over them, two colours.
- `jump-over-wall` — start and end with `obstacle` hexes between them; the jump
  arc clears the wall the walk would hit.
- `jump-scale` — a short hop and a long jump; the apex tick grows with distance.
- `route-4-corners` — six waypoints / four sharp corners spanning a radius-8
  board: dashed straight vs thin curved, same path.
- `offset` — arrow across a non-origin part of the board.

## Done when

- `npm run typecheck && npm test` pass.
- `hexArrow` + the arrow types re-exported from `src/index.ts`.
- `scenarios/index.html` shows an `arrow` section covering every style.
- README "Layout" + "Planned utilities" updated.
