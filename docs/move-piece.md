# Session spec: move-piece

Goal: animate a board piece from one hex to another so every move **feels
snappy** — the piece keeps a near-constant on-screen speed for short hops but
**accelerates over distance** so a long slide doesn't drag (`durationMs ~
hexes ** falloff`, `falloff` 0.65). Two modes: `ground` (slide) and `jump`
(slide + zoom up at the apex, back down on landing, faking height).

Like `hexArrow`, this is a **visual-layer helper**, not a `Cube[]` utility.
`movePiece` is pure: it returns an animation *plan* (duration + a transform
sampler + WAAPI keyframes). The caller — or the scenario's inline JS — runs it.
Element-agnostic: drives any SVG element whose local origin is its own centre
(hex polygon, player disc, ball).

## Scope

**In:** `src/move-piece/move-piece.ts` — `movePiece(start, end, options?)` +
`moveKeyframes(plan, steps?)`, its tests, player + ball markers added to
`src/test-utils/board.ts`, and an interactive scenario action
`scenarios/actions/move-piece/` authored in
`src/move-piece/move-piece.playground.test.ts` through a new
`src/test-utils/piece-playground.ts`.

**Out (defer):** following a multi-hex path or an arrow curve (straight chord
only); rotation / facing; queuing or easing between successive moves; flat-top;
an actual arced trajectory for `jump` (position stays on the chord — only
`scale` sells the height); physics; canvas / WebGL.

## Function — `move-piece.ts`

```ts
export type MoveMode = "ground" | "jump";

export interface MoveOptions {
  mode?: MoveMode;    // default "ground"
  speed?: number;     // hexes/sec for a 1-hex step (reference speed), default 6
  falloff?: number;   // distance exponent, default 0.65; 1 = constant speed
  size?: number;      // hex centre-to-corner px, default DEFAULT_HEX_SIZE
  jumpPeak?: number;  // scale at the apex, jump only, default 1.6
  minMs?: number;     // floor for a non-zero move, default 90
}

export interface MoveFrame { x: number; y: number; scale: number; }

export interface MovePlan {
  from: Pixel;        // cubeToPixel(start, size)
  to: Pixel;          // cubeToPixel(end, size)
  hexes: number;      // cubeDistance(start, end)
  durationMs: number; // hexes ** falloff / speed * 1000, clamped >= minMs
  mode: MoveMode;
  at(t: number): MoveFrame;  // t clamped to [0, 1]
}

export function movePiece(start: Cube, end: Cube, options?: MoveOptions): MovePlan;

export function moveKeyframes(
  plan: MovePlan,
  steps?: number,     // default 24
): Array<{ offset: number; transform: string }>;
```

### Behaviour

- **Duration.** `durationMs = (hexes ** falloff / speed) * 1000`, floored at
  `minMs` when `hexes > 0`. `speed` calibrates the 1-hex step; `falloff < 1`
  makes each extra hex add less time than the last, so long moves accelerate
  (`falloff: 1` → strictly constant px/ms). A 5-hex slide at the defaults takes
  ~2.8x a step, not 5x.
- **Position.** Linear lerp along the straight chord: `at(t).{x,y} =
  from + (to - from) * t`. No easing on position — the speed profile lives in
  `durationMs`, so the runner passes `easing: "linear"` to WAAPI.
- **`ground`.** `scale === 1` for every `t`.
- **`jump`.** `scale = 1 + (jumpPeak - 1) * sin(pi * t)` — `1` at both ends,
  `jumpPeak` at `t = 0.5`, smooth and symmetric.
- **In place.** `start === end` → `from === to`, `hexes = 0`.
  `ground` → `durationMs = 0`. `jump` → `durationMs = minMs` and the scale
  curve still runs (a hop on the spot).
- `moveKeyframes`: `steps + 1` evenly spaced samples, `offset` from `0` to `1`,
  `transform = "translate(<x>px, <y>px) scale(<s>)"` — **CSS** syntax (commas,
  `px`) so it feeds `element.animate` directly. WAAPI animates the CSS
  `transform` *property*, not the SVG attribute, so the element needs
  `transform-box: fill-box; transform-origin: center` for the scale to pivot on
  the piece. Consumer:
  `el.animate(moveKeyframes(plan), { duration: plan.durationMs, easing: "linear" })`.
- Pure; builds on `layout.ts` (`cubeToPixel`, `DEFAULT_HEX_SIZE`) and
  `distance.ts` (`cubeDistance`). Never mutates inputs. Deterministic strings.

### Consumer assumption

The moved element's **local origin is its visual centre**, so `translate` lands
the centre on the hex centre and `scale` grows about it. The scenario markers
and the existing `.piece` group already follow this.

## Pieces — `test-utils/board.ts`

Two markers, each a `<g>` centred on `(0, 0)`, scaled off the hex `size`:

| marker | shape | notes |
| --- | --- | --- |
| `playerMarker(size, color, label)` | filled circle `r ~ size * 0.6`, white stroke, centred white number | smaller than the hex; `color` is the fill |
| `ballMarker(size)` | white circle `r ~ size * 0.34` with black/white stripes | stripes = a `<pattern>` of rotated bars clipped to the circle; thin grey outline |

## Scenario — `actions/move-piece`

`src/test-utils/piece-playground.ts` → `writePiecePlayground(slug, label, blurb,
cases)`, same shape as `writeMovementPlayground`: one page, one
`<section class="case">` per case, a baked board `<svg>`, a `<g class="piece">`
(player or ball), and a HUD with a `mode` toggle (ground / jump) + `reset`. One
inline `<script>` carries a JS mirror of `movePiece` (no `${` or backticks) and
drives it from `requestAnimationFrame`, writing the SVG `transform` attribute
each frame (avoids the CSS-transform / `transform-box` friction of WAAPI on SVG).
Click any hex to send the pieces there; obstacles are ignored — reachability is
`movement`'s job, not this one's.

Cases — `move-piece.playground.test.ts`:

| case | piece | shows |
| --- | --- | --- |
| `step` | player | one-neighbour hop, ground |
| `slide` | player | ~5-hex move, ground — longer, but not 5x longer (accelerates) |
| `speed-match` | player | near + far target on one board; the far one covers more px/ms |
| `ball-roll` | ball | ground move of the small striped circle |
| `hop` | player | `jump` a short gap — zoom up at apex, down on land |
| `long-jump` | player | `jump` across the board — same `jumpPeak`, longer airtime |
| `jump-vs-ground` | player + ball | same endpoints: ball slides under, player jumps over |

Tests: every case on the page; the inline mirror's `durationMs` and `at(0.5)`
match `movePiece` for a sample move (drift would make the scenario lie); a
`jump` frame at `t = 0.5` has `scale === jumpPeak`; every `ground` frame has
`scale === 1`; `durationMs` grows with distance but sub-linearly (`hexes **
falloff`).

## Tests — `move-piece.test.ts`

- `durationMs` grows with `cubeDistance` but sub-linearly (5-hex < 5x the 1-hex
  time); `falloff: 1` restores equal pixels-per-ms across distances.
- `from` / `to` equal `cubeToPixel(start / end, size)`; `size` override scales
  them.
- `at(0) == from`, `at(1) == to`, `at(0.5) ==` chord midpoint; `t` clamps
  outside `[0, 1]`.
- `ground`: `scale === 1` at `t` = 0, .25, .5, 1.
- `jump`: `scale` is 1 at `t` 0 and 1, `jumpPeak` at `t` 0.5, `> 1` and
  symmetric between; `jumpPeak` option respected.
- `speed`, `falloff` and `minMs`: a tiny move is floored at `minMs`; a far move
  with the default `falloff` covers more px/ms than a step; `start === end` →
  `durationMs` 0 for `ground`, `minMs` for `jump`, `from === to`.
- `moveKeyframes`: `steps + 1` entries, `offset` 0..1 monotonic, transform
  strings well-formed and `.toFixed(2)`; deterministic.
- Pure: inputs not mutated; same args → identical plan and strings.

## Done when

- `npm run typecheck && npm test` pass.
- `movePiece`, `moveKeyframes`, `MoveMode`, `MoveOptions`, `MoveFrame`,
  `MovePlan` re-exported from `src/index.ts`.
- `scenarios/index.html` lists the `move-piece` action; on the page short and
  long slides both feel snappy (long ones accelerate), `jump` zooms up and
  back, `reset` restores.
- README "Layout" + "Visual scenarios" + "Planned utilities" updated
  (`move-piece` — animate a piece hex→hex, ground slide or zooming jump).
