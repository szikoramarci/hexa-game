# Session spec: tackle (defender tackle inside the movement action)

Goal: let a **defender**, mid movement action, spend its whole remaining budget to
**lunge onto the opposing ball carrier** and contest the ball with a dice
challenge. Winner's controller then repositions the carrying piece. Pure logic,
composes the existing lego (`pathCubes`, `dice`, `move-action`). No DOM/timers.

## Placement

Extend `move-action` — a tackle is another way to `commit` from `aiming`. New
helpers + phases live in `src/move-action/move-action.ts`; tests grow
`move-action.test.ts`. `resolveChallenge` is written **generic** (reused later by
shot/save, aerial) with a note that it moves to `src/challenge/` when a second
caller lands.

## Rules

Defender = active piece, `aiming`, enemy ball carrier on the board.

| step | rule |
| --- | --- |
| offer | tackle is available iff the defender can reach the carrier's hex within `movePoints` (carrier hex allowed only as the **final** step; all other pieces + obstacles block) |
| cost | committing a tackle spends **all** remaining move points, whatever the result |
| lunge | defender walks the approach, resting on the last hex before the carrier (`approachEnd`); the final step onto the carrier hex is the contest, defender never occupies it |
| challenge | `d6 + defender.tackling` vs `d6 + attacker.dribbling` |
| foul | defender's raw `d6` is `1` → **foul**, overrides the comparison — TODO, handled separately |
| tie | equal final scores → **loose ball** — TODO, handled later |
| defender wins | defender takes the ball; controller relocates the defender to any **free neighbour of the attacker**; cancel → defender returns to `tackleStart` (its hex when the tackle was committed) |
| attacker wins | attacker keeps the ball; controller relocates the attacker to any **free hex around the defender** (`approachEnd`); cancel → attacker stays put |

`tackleStart` = `path[0]`. `approachEnd` = `path[len - 2]`. Attacker never moves
during the lunge; on defender-win it stays; on attacker-win only its final spot
changes.

## Reusable methods

| fn | signature | notes / reuse |
| --- | --- | --- |
| `freeNeighbours` | `(state, hex) => Cube[]` | the 6 neighbours holding no piece and no obstacle. Pitch-bounds filtering deferred (no pitch model). Reused by relocation, future pass targets, loose-ball scatter. |
| `reachTackle` | `(state, defenderId, carrierId?) => { path: Cube[]; approachEnd: Cube; start: Cube } \| null` | `pathCubes` with blockers = `blockersFor(state, defenderId)` **minus the carrier hex**, then require the path to end on the carrier hex and `path.length - 1 <= movePoints`. `path` includes both ends. General idea: "route to an occupied hex". |
| `tackleTarget` | `(state, defenderId) => Piece \| null` | the enemy `ballCarrier` iff `reachTackle` succeeds. Thin. |
| `resolveChallenge` | `(rng, attackerAttr, defenderAttr, die?=6) => ChallengeRoll` | **generic** `d6+attr` contest. `{ attackerRoll, defenderRoll, attackerScore, defenderScore, winner: "attacker" \| "defender" \| null, tie: boolean, rng }`. `winner=null` + `tie=true` on equal scores. `rng` advanced by exactly 2 draws (attacker first). No foul logic here. |
| `tackleFoul` | `(defenderRoll) => boolean` | `defenderRoll === 1`. Named so the rule has one home; tackle layer applies it on top of `resolveChallenge`. |
| `relocationOptions` | `(state, outcome) => Cube[]` | defender-win → `freeNeighbours(attacker.at)`; attacker-win → `freeNeighbours(outcome.approachEnd)`. May be empty. |
| `applyTackle` | `(state, outcome, dest: Cube \| null) => MoveActionState` | pure transition, sibling of `applyMove`: defender `movePoints = 0` and `at = approachEnd` (or `start` when defender-win + `dest === null`); `ball` → winner's new hex; winner `at = dest ?? fallback`. Never mutates input. |

`outcome` (internal, carried in the snapshot from the resolving step until
relocation): `{ defenderId, attackerId, at, start, approachEnd, roll: ChallengeRoll, foul: boolean, winner: "attacker" | "defender" | null }`.

## Type changes

```ts
export interface Piece {
  // ...existing
  attrs?: { dribbling?: number; tackling?: number };  // 1..6; see domain-model
}

export interface MoveActionState {
  // ...existing
  defaultAttr?: number;   // used when a Piece omits an attr. default 3
}
```

## Reducer

New phases: `"tackling"` (walking the approach + lunge), `"relocating"`
(awaiting the winner's placement), `"foul"`, `"looseBall"` (both dead ends, like
`stopped`).

```ts
export type MovePhase =
  | "idle" | "aiming" | "moving" | "stopped" | "spent"
  | "tackling" | "relocating" | "foul" | "looseBall";

export type MoveActionEvent =
  | /* ...existing */
  | { type: "tackle"; hex?: Cube }       // hex defaults to the reachable carrier
  | { type: "relocate"; hex: Cube };     // pick a relocationOptions hex
```

| phase | event | → |
| --- | --- | --- |
| `aiming` | `tackle` (`reachTackle` ok) | `tackling`, `path` = approach incl. carrier hex, `stepIndex 0` |
| `tackling` | `advance` | walk one hex; on the **final** step (onto carrier hex) roll `resolveChallenge`, apply `tackleFoul`, then → `foul` / `looseBall` / `relocating`; defender `movePoints` forced to 0 here |
| `relocating` | `relocate` (hex ∈ `relocationOptions`) | `applyTackle(dest)` → `spent` |
| `relocating` | `cancel` | `applyTackle(null)` (fallback) → `spent` |
| `foul` / `looseBall` | `selectPiece` / `cancel` | leave to `aiming` / `idle` |

Everything else (wrong phase, `reachTackle` null, `relocate` to a non-option,
re-select mid-`tackling`) returns the snapshot **unchanged**. Pure; `snap` never
mutated. Ball is **not** changed on `foul` / `looseBall` yet (see TODOs).

### `moveView` additions

```ts
tackle: { carrierId: string; path: Cube[]; approachEnd: Cube } | null;  // aiming only — drives a "Tackle" affordance + preview
challenge: ChallengeRoll & { attackerId; defenderId; at: Cube } | null; // set the frame the dice resolve
relocation: Cube[] | null;                                              // relocating only — the legal spots
foul: { attackerId; defenderId; at: Cube } | null;                      // TODO marker
looseBall: { attackerId; defenderId; at: Cube } | null;                 // TODO marker
```

`step` for the final `tackling` segment carries `contest: [carrierId]` so the UI
animates a lunge, not a walk.

## TODOs to leave in code

- `// TODO(foul): a foul is resolved by its own action — free kick / card / advantage. For now: phase "foul", ball unchanged, defender's MP already spent.`
- `// TODO(loose-ball): tie → loose ball. Later: scatter (domain-model "Loose ball scatter"). For now: phase "looseBall", ball unchanged.`

## Test scenarios — `move-action.test.ts`

**`freeNeighbours`**
1. all six open → six hexes; a piece on one and an obstacle on another → the other four; carrier's own hex never counts (it holds a piece).

**`reachTackle`**
2. defender 2 MP, carrier 2 hexes away, open → `path` length 3, `approachEnd` = the middle hex, `start` = defender hex.
3. defender 1 MP, same → `null` (budget).
4. carrier only reachable by passing through a wall / another piece → `null`.
5. defender already adjacent → `path` length 2, `approachEnd === start`.
6. carrier hex is *not* treated as a blocker, but pieces/obstacles on the way still are.

**`tackleTarget`**
7. `null` with no ball; `null` when the carrier is a teammate; `null` when out of range; the carrier piece otherwise.

**`resolveChallenge`**
8. fixed seed → known `attackerRoll` / `defenderRoll`; `winner` follows the higher score.
9. equal scores → `winner: null`, `tie: true`.
10. `rng` advances by exactly two draws, attacker rolled first (thread `rollDie` twice to cross-check).
11. a higher attribute flips an otherwise-tied pair of raw rolls.

**`tackleFoul`**
12. `true` iff the defender's raw roll is `1`, independent of scores.

**reducer — flow**
13. `aiming --tackle--> tackling`; each `advance` walks one approach hex; the final `advance` resolves; wrong-phase `tackle` and `reachTackle`-null `tackle` are no-ops.
14. committing a tackle forces defender `movePoints` to 0 (checked on every branch: win, foul, tie, cancel).

**reducer — defender wins**
15. ball moves to the defender; phase `relocating`; `moveView.relocation` = `freeNeighbours(attacker.at)`; attacker unmoved.
16. `relocate` to an option → defender there with the ball, phase `spent`.
17. `cancel` → defender at `start`, still holding the ball, phase `spent`.
18. `relocate` to a non-option hex → unchanged.

**reducer — attacker wins**
19. ball stays with the attacker; `moveView.relocation` = `freeNeighbours(approachEnd)`; defender rests at `approachEnd`.
20. `relocate` moves the attacker; `cancel` leaves the attacker on its original hex.
21. every hex around the defender occupied → `relocation` empty → only `cancel` works.

**reducer — foul / tie (TODO markers)**
22. defender rolls `1` → phase `foul`, `moveView.foul` set, ball unchanged, defender MP 0; `selectPiece` / `cancel` leaves it.
23. equal scores → phase `looseBall`, `moveView.looseBall` set, ball unchanged.

**determinism**
24. a fixed seed replays the full tackle — rolls, winner, and (with the same relocate/cancel events) final positions — identically.

## Playground scenarios — `actions/movement`

`PlaygroundPiece` gained `attrs`, `MovementPlayground` gained `defaultAttr`; the
inline mirror learned `reachTackle` / `resolveChallenge` / `freeNeighbours` /
`relocationOptions` / `applyTackle` and the `tackling` / `relocating` / `foul` /
`looseBall` phases. A selected defender in range makes the enemy carrier glow
red (`.tackle-target`) and draws the approach arrow with a red lunge head; click
the carrier to tackle. Resolution logs a `.log` line under the board (kept until
`reset`): the challenge dice (`d6 r+tackling vs d6 r+dribbling -> scores`) and a
plain result — **successful tackle** / **failed tackle** / **foul** / **loose
ball**. The ball-steal check logs the same way — **successful ball-steal** /
**failed ball-steal** with its `d6` rolls.
`relocating` paints the legal spots green (click to place) and shows a **stay**
button (cancel). Foul / loose ball print a `TODO` status and dead-end.

Cases added to `movement.playground.test.ts`:

| case | setup | shows |
| --- | --- | --- |
| Close down the carrier | defender 3 MP `tackling 5`, carrier `dribbling 2`, 3 away | approach → tackle → defender wins → relocate around the attacker |
| Just out of reach | defender 2 MP, carrier 3 away | no tackle offered |
| The carrier rides the challenge | carrier `dribbling 6` vs `tackling 1` | attacker wins → push the attacker to a hex around the defender |
| Shoulder to shoulder | adjacent, equal attributes | whatever the baked seed rolls; `reset` re-rolls |

Foul and loose ball surface on some `reset` rolls (the baked seed is fixed per
case). The test cross-checks `reachTackle` / `relocationOptions` / the resolved
`outcome` against the real module for each baked seed.

## Done when

- [x] `npm run typecheck && npm test` pass.
- [x] `tackle` / `relocate` events, the new phases, and the helpers
  (`freeNeighbours`, `reachTackle`, `tackleTarget`, `resolveChallenge`,
  `tackleFoul`, `relocationOptions`, `applyTackle`) are re-exported from
  `src/index.ts`.
- [x] `docs/domain-model.md` "Challenges/Tackle" cross-links this spec; README
  updated. Foul + loose ball remain explicit TODOs (`TODO(foul)` /
  `TODO(loose-ball)` in `move-action.ts`).
- [x] `scenarios/actions/movement`: the tackle cases play through — the inline
  playground mirror carries the full tackle flow (`tackling` / `relocating` /
  `foul` / `looseBall`), click-to-tackle and click-to-relocate.
