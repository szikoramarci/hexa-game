# Session spec: move-action (the movement action)

Goal: the reusable **movement action** — the process that drives "pick a piece,
see where it can go, aim, walk it there". Pure game-logic layer that composes the
existing lego (`reachableCubes`, `pathCubes`, `hexArrow`, `movePiece`, `dice`);
no DOM, no rendering, no timers.

Two ways to use it, same primitives underneath:

1. **Direct functions** — `reachableForPiece`, `movePath`, `moveArrow`,
   `pathHazards`, `ballCarrier`, `influencers`, `applyMove`. Call them yourself
   in whatever order your UI needs.
2. **Event reducer** — `initMoveAction` / `moveAction(snapshot, event)` /
   `moveView(snapshot)`. Feed it UI events (`selectPiece`, `hoverHex`, `commit`,
   `advance`, `cancel`); it walks the `idle → aiming → moving → (spent | stopped)`
   flow and hands the renderer a flat view each step.

## Ball steal

While the moving piece **carries the ball** (it stands on `state.ball`), each
step is checked. A `d6` is rolled for every opponent whose *influence* — the six
hexes around it — the carrier **steps into** on that hex: covers the hex just
entered but *not* the one just left. Walking forward while staying inside the
same opponent's influence does **not** roll again; leaving and re-entering does.
A roll `<= stealOn` (default `1`) hands that opponent the ball and **ends the
move on that hex** (phase `stopped`). Rolls come from a seeded PRNG (`src/dice`)
carried in the snapshot, so a whole game replays. Only the carrier is at risk; a
non-carrier walks through influence untouched.

`enteredInfluence(state, from, to, team)` is the primitive — the opponents `to`
adds over `from`. `pathHazards` marks the step-in hexes along a previewed path.

## Scope

**In:** `src/move-action/move-action.ts` + tests, and `src/dice/` (seeded PRNG,
`docs/dice.md`). Re-exports. The movement playground
(`src/test-utils/movement-playground.ts` + its test) reworked so its inline
mirror follows this model, including teams, a ball, the steal check and the
pre-move hazard preview.

**Out (defer):** action points beyond move (attack, ability); zones of control
beyond the steal check; weighted terrain (unit step cost only); undo/redo; turn
order; facing; flat-top; loose balls (a carrier is always assumed).

## Game state

```ts
export interface Piece {
  id: string;
  label: string | number;   // drawn on the disc
  at: Cube;
  movePoints: number;        // hexes it may travel this action (non-negative int)
  team: string;              // exactly two teams are in play
}

export interface MoveActionState {
  pieces: readonly Piece[];
  obstacles: readonly Cube[];   // static blockers
  piecesBlock?: boolean;        // other pieces block movement too. default true
  ball?: Cube;                  // the hex the ball is on; its carrier stands there
  stealDie?: number;            // steal-check die. default 6
  stealOn?: number;             // a roll <= this steals. default 1
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

// the steps of `path` that sit in enemy influence — the hexes where the ball
// could be stolen. Empty unless `pieceId` is the carrier.
pathHazards(state: MoveActionState, pieceId: string, path: readonly Cube[]): Cube[];

// the piece standing on state.ball, or null
ballCarrier(state: MoveActionState): Piece | null;

// opponents of `team` whose 6 surrounding hexes cover `hex`, sorted by id
influencers(state: MoveActionState, hex: Cube, team: string): Piece[];

// piece ends at path's last hex, movePoints -= (path.length - 1); the ball
// rides along if the mover held it. Other pieces untouched. Returns a new state.
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
export type MovePhase = "idle" | "aiming" | "moving" | "stopped" | "spent";

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
  rng: Rng;            // seeded PRNG state; advances one draw per steal roll
  steal: StealOutcome | null;   // set the frame a steal ends the move
}

interface StealOutcome { by: string; at: Cube; rolls: number[]; }

// `seed` fixes every steal check. default 1.
initMoveAction(state: MoveActionState, seed?: number | string): MoveActionSnapshot;
moveAction(snap: MoveActionSnapshot, event: MoveActionEvent): MoveActionSnapshot;
moveView(snap: MoveActionSnapshot): MoveActionView;
```

Transitions:

| phase | event | →  |
| --- | --- | --- |
| any but `moving` | `selectPiece` (known id) | `aiming` (or `spent` if 0 MP); clears target/path |
| `aiming` | `hoverHex` h | recompute `path`/`target` (cleared if `h` null or unreachable) |
| `aiming` | `commit` (reachable hex, ≥1 step) | `moving`, `stepIndex 0` |
| `moving` | `advance` | walk **one hex**. If the carrier lands in enemy influence, roll — a steal → `stopped` (ball to the thief, move ends here). On the last hex with no steal: `applyMove`, then `aiming` (or `spent`) |
| not `moving` | `cancel` | `idle` |

Anything else (event in the wrong phase, unknown piece, unreachable
`commit`/`hoverHex`) returns the snapshot **unchanged**. `moveAction` never
mutates `snap`. `stopped` is a dead end — `selectPiece` or `cancel` leaves it.

```ts
export interface MoveActionView {
  phase: MovePhase;
  active: Piece | null;
  pieces: readonly Piece[];          // current positions
  ball: Cube | null;
  carrying: boolean;                 // does the active piece hold the ball?
  reachable: Cube[];                 // [] unless aiming/spent
  target: Cube | null;
  path: Cube[];
  arrow: MoveArrow | null;           // moveArrow(path)
  hazards: Cube[];                   // previewed-path steps in enemy influence
  // one hex segment of the walk (moving only). Animate from->to, dispatch
  // `advance`, repeat until it is null — the piece steps through every hex.
  step: { from: Cube; to: Cube; index: number; count: number; contest: string[] } | null;
  steal: StealOutcome | null;
}
```

### Consumer sketch

```ts
let s = initMoveAction({ pieces, obstacles, ball }, "match-42");
s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
// moveView(s).reachable -> highlight
s = moveAction(s, { type: "hoverHex", hex: h });
// moveView(s).hazards -> mark risky hexes, make the carrier look wary
s = moveAction(s, { type: "commit", hex: h });
while (moveView(s).step) {
  const { from, to } = moveView(s).step!;
  await runAnimation(movePiece(from, to));   // the move-piece lego
  s = moveAction(s, { type: "advance" });
}
if (moveView(s).steal) { /* the ball changed hands, move ended early */ }
```

## Tests — `move-action.test.ts`

- `reachableForPiece` / `movePath` / `moveArrow` / `applyMove` as before, plus
  `applyMove` carries the ball with its holder and leaves it put for others.
- `ballCarrier` / `influencers` / `enteredInfluence` / `pathHazards`: carrier is
  the piece on the ball hex; influencers are enemies exactly one hex away,
  sorted; `enteredInfluence` is `to`'s influencers minus `from`'s; `pathHazards`
  flags only the step *into* an influence (not staying, and re-entry counts),
  and nothing for a non-carrier.
- reducer flow: `select → hover → commit → advance*` lands the piece; `commit`
  with `hex` skips hover; `spent` at 0 MP; re-`selectPiece` switches; `cancel`
  → `idle`; wrong-phase / unknown-id are no-ops; no re-select mid-move.
- steal: a seed rolling `1` → `stopped`, ball to the opponent, mover halted on
  the contested hex, points spent for what it walked; a calm seed completes and
  the ball follows; one roll per adjacent opponent, first (by id) that hits
  steals, `rng` advances; a non-carrier is never rolled for; `moveView.step
  .contest` / `.hazards` expose the danger; a fixed seed replays a steal.

## Playground — `actions/movement`

`PlaygroundPiece` gains `team` and `hasBall?`; `MovementPlayground` gains
`piecesBlock` / `stealDie` / `stealOn`. The inline script mirrors the full
reducer including the seeded steal check (`mulberry32`, matching `src/dice`).
Preview: hovering a risky path pulses the contested hexes red, reddens the
arrow, and the carrier marker shivers (`.wary`). New cases: *carry the ball past
a defender*, *run the gauntlet — two defenders* (chokepoint = two rolls).
`reset` re-rolls the seed. The test cross-checks the inline flood and the baked
per-case seed against the real modules.

## Done when

- `npm run typecheck && npm test` pass.
- `move-action` + `dice` APIs re-exported from `src/index.ts`.
- `scenarios/actions/movement`: select + aim + walk across every case; ball
  cases show hazards + wobble on aim and a steal (or safe run) on commit.
- README "Layout" + "Visual scenarios" + "Planned utilities" updated.
