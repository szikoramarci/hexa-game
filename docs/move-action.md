# Session spec: move-action (the movement action)

Goal: the reusable **movement action** — the process that drives "pick a piece,
see where it can go, aim, walk it there". Pure game-logic layer that composes the
existing lego (`reachableCubes`, `pathCubes`, `hexArrow`, `movePiece`); no DOM,
no rendering, no timers.

Two ways to use it, same primitives underneath:

1. **Direct functions** — `reachableForPiece`, `movePath`, `moveArrow`,
   `applyMove`. Call them yourself in whatever order your UI needs.
2. **Event reducer** — `initMoveAction` / `moveAction(snapshot, event)` /
   `moveView(snapshot)`. Feed it UI events (`selectPiece`, `hoverHex`, `commit`,
   `advance`, `cancel`); it walks the `idle → aiming → moving → spent` flow and
   hands the renderer a flat view each step.

## Scope

**In:** `src/move-action/move-action.ts` + tests. Re-exports. The movement
playground (`src/test-utils/movement-playground.ts` + its test) reworked so its
inline mirror follows this event/phase model and multiple pieces can be
selected.

**Out (defer):** action points beyond move (attack, ability); zones of control;
weighted terrain (unit step cost only — `reachableCubes` / `pathCubes` as-is);
undo/redo; turn order / players; facing; flat-top.

## Game state

```ts
export interface Piece {
  id: string;
  label: string | number;   // drawn on the disc
  at: Cube;
  movePoints: number;        // hexes it may travel this action (non-negative int)
}

export interface MoveActionState {
  pieces: readonly Piece[];
  obstacles: readonly Cube[];   // static blockers
  piecesBlock?: boolean;        // other pieces block movement too. default true
}
```

## Direct functions

```ts
// hexes this piece can reach (its own hex excluded)
reachableForPiece(state: MoveActionState, pieceId: string): Cube[];

// shortest in-budget path piece.at -> target (both ends included), or null
// when unreachable / beyond movePoints
movePath(state: MoveActionState, pieceId: string, target: Cube): Cube[] | null;

// dashed straight ArrowSpec for a path (feeds hexArrow / Scenario.arrows), or
// null for a <2-hex path. style overrides the dashed-orange default.
moveArrow(path: readonly Cube[], style?: ArrowStyle): MoveArrow | null;

// piece ends at path's last hex, movePoints -= (path.length - 1); other pieces
// untouched. Returns a new state.
applyMove(state: MoveActionState, pieceId: string, path: readonly Cube[]): MoveActionState;
```

- Blockers a piece sees = `obstacles` + (unless `piecesBlock === false`) every
  *other* piece's hex. Its own hex never blocks.
- `reachableForPiece` = `reachableCubes(piece.at, piece.movePoints, blockers)`
  minus `piece.at`. `movePath` = `pathCubes(...)` + a `length - 1 <= movePoints`
  check. Unknown `pieceId` throws `RangeError`.
- Pure; never mutates `state` or its cubes.

## Event reducer

```ts
export type MovePhase = "idle" | "aiming" | "moving" | "spent";

export type MoveActionEvent =
  | { type: "selectPiece"; pieceId: string }
  | { type: "hoverHex"; hex: Cube | null }
  | { type: "commit"; hex?: Cube }   // click; defaults to the hovered target
  | { type: "advance" }              // one hex step finished animating
  | { type: "cancel" };

export interface MoveActionSnapshot {
  state: MoveActionState;
  phase: MovePhase;
  activeId: string | null;
  target: Cube | null;
  path: Cube[];        // to target while aiming; the committed route while moving
  stepIndex: number;   // hexes walked so far while moving
}

initMoveAction(state: MoveActionState): MoveActionSnapshot;   // phase "idle"
moveAction(snap: MoveActionSnapshot, event: MoveActionEvent): MoveActionSnapshot;
moveView(snap: MoveActionSnapshot): MoveActionView;
```

Transitions:

| phase | event | →  |
| --- | --- | --- |
| any but `moving` | `selectPiece` (known id) | `aiming` (or `spent` if 0 MP); clears target/path |
| `aiming` | `hoverHex` h | recompute `path`/`target` (cleared if `h` null or unreachable) |
| `aiming` | `commit` (reachable hex, ≥1 step) | `moving`, `stepIndex 0` |
| `moving` | `advance` | walk **one hex** (`stepIndex++`); on the last hex: `applyMove`, then `aiming` (or `spent`) |
| not `moving` | `cancel` | `idle` |

Anything else (event in the wrong phase, unknown piece, unreachable
`commit`/`hoverHex`) returns the snapshot **unchanged**. `moveAction` never
mutates `snap`.

```ts
export interface MoveActionView {
  phase: MovePhase;
  active: Piece | null;
  pieces: readonly Piece[];          // current positions
  reachable: Cube[];                 // [] unless aiming/spent
  target: Cube | null;
  path: Cube[];
  arrow: MoveArrow | null;           // moveArrow(path)
  // one hex segment of the walk (moving only). Animate from->to, dispatch
  // `advance`, repeat until it is null — the piece steps through every hex.
  step: { from: Cube; to: Cube; index: number; count: number } | null;
}
```

### Consumer sketch

```ts
let s = initMoveAction({ pieces, obstacles });
s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
// moveView(s).reachable -> highlight
s = moveAction(s, { type: "hoverHex", hex: h });
// hexArrow(moveView(s).arrow!.hexes, moveView(s).arrow!) -> draw
s = moveAction(s, { type: "commit", hex: h });
while (moveView(s).step) {
  const { from, to } = moveView(s).step!;
  await runAnimation(movePiece(from, to));   // the move-piece lego
  s = moveAction(s, { type: "advance" });
}
// piece now at h, movePoints spent
```

## Tests — `move-action.test.ts`

- `reachableForPiece`: equals `reachableCubes` minus own hex; other pieces block
  (and don't when `piecesBlock: false`); obstacles block; 0 MP → `[]`.
- `movePath`: shortest path incl. endpoints; `null` past `movePoints`; `null`
  when boxed in; routes around a wall; `target === at` → `[at]`.
- `moveArrow`: `null` for <2 hexes; dashed straight spec; `style` overrides.
- `applyMove`: piece at destination, `movePoints` down by step count, others
  unchanged, inputs not mutated.
- reducer: `init` → `idle`; full `select → hover → commit → advance*` lands the
  piece and spends points; `commit` with explicit `hex` skips hover;
  re-`selectPiece` switches; `cancel` → `idle`; wrong-phase / unknown-id events
  are no-ops; chain two moves within budget; `moveAction` returns a fresh
  snapshot.

## Playground — `actions/movement`

`MovementPlayground` gains `pieces: { at, label, movePoints }[]` (drop `budget`)
and the inline script becomes an explicit mirror of the reducer: click a piece
to select, hover a reachable hex for the arrow, click it to walk, click another
piece to switch. New case: two pieces, one blocks the other's path. The
playground test cross-checks the inline `reachable` / `path` against
`reachableForPiece` / `movePath`.

## Done when

- `npm run typecheck && npm test` pass.
- `move-action` API re-exported from `src/index.ts`.
- `scenarios/actions/movement` shows piece selection + aim + walk across every
  case; the two-piece case blocks correctly.
- README "Layout" + "Visual scenarios" + "Planned utilities" updated.
