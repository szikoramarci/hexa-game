# Session spec: foul (injury + card off a tackle foul)

Goal: resolve the **foul** dead end left by the tackle. A defender's raw `1`
already flags the foul, keeps the ball with the carrier, spends the defender's
points. Now: roll an **injury check** on the fouled carrier and a **yellow-card
check** on the fouler, apply both to state, then hand the attacking controller
the advantage decision (play on / take the set piece). A second yellow sends the
fouler off and forces the stop. Performing the free kick / penalty is deferred.

## Placement

New utility `src/foul/foul.ts` + `foul.test.ts` + `foul.visual.test.ts`.
`move-action.ts` imports it one-directionally (no cycle, like `loose-ball`) and
calls it from `resolveTackle` on the foul branch. `tackleFoul` (the `=== 1`
predicate) moves from `move-action.ts` into `src/foul/`; re-exported for
compatibility. `docs/domain-model.md` "Challenges" + "Deferred" are the rules
source — update the injury line there.

## Rules

Foul = defender's raw challenge `d6` is `1` (`tackleFoul`). On a foul the
comparison is void: `winner = null`, ball unchanged (carrier keeps it), defender
walked to `approachEnd` with `movePoints = 0`. Then, **always**, in order:

| check | roll | effect |
| --- | --- | --- |
| injury | `d6` vs the **fouled carrier**'s `resilience` | `roll >= resilience` → carrier gets the `injured` tag; its `movePoints` drop by 2 (floor 0) |
| card | `d6` vs global `refereeLeniency` (3..6) | `roll >= refereeLeniency` → yellow to the **fouler**; his 2nd yellow → `sentOff` |

- Pace **is** `movePoints` — there is no separate stat. Injury reduces it by 2:
  applied to the carrier's current `movePoints` now, and the `injured` tag makes
  it stick for any future turn refresh (that refresh is deferred, no turn model
  yet).
- `injured` is a boolean tag. A second injury on an already-injured player is a
  no-op (the tag, not a counter) — and `movePoints` is not docked twice.
- Floor `movePoints` at 0; healthy pace is `3..6` so this only bites a player
  already down to 1.
- `refereeLeniency` is rolled `3..6` once at game start by the caller (game
  setup / playground), stored on `MoveActionState`. Default `4` when omitted.
- Strict ref = low leniency (`3` → a `3+` books); lenient ref = high (`6` → only
  a `6`).

### Advantage decision

After the checks:

- **`sentOff`** → no choice. The game stops; the rules layer takes the set
  piece. `decision` is forced to `"stop"`.
- otherwise the attacking controller picks:
  - **play on** (`decision: "play"`) — TODO, not yet described; for now a
    terminal marker, ball still with the carrier.
  - **take the set piece** (`decision: "stop"`) — TODO, free kick / penalty by
    the foul hex's area; for now a terminal marker.

Both branches dead-end this session (`selectPiece` / `cancel` leaves, as today).
The `foul` phase just carries the resolved rolls + the decision for the rules
layer.

## Type changes

```ts
export interface Piece {
  // ...existing — `movePoints` already carries pace
  attrs?: {
    dribbling?: number; tackling?: number;
    resilience?: number;  // 1..6; injury resistance
  };
  injured?: boolean;      // foul-injury tag; -2 movePoints, persists
  yellows?: number;       // yellow cards this game; 2 → sent off
  sentOff?: boolean;      // second yellow
}

export interface MoveActionState {
  // ...existing
  refereeLeniency?: number;  // 3..6, rolled at game start. Default 4.
}
```

`attrOf`'s key union widens to include `"resilience"` (fallback `defaultAttr ??
3`). No `pace` key — `movePoints` is pace.

## API — `src/foul/foul.ts`

```ts
/** The tackle-specific foul trigger: the defender's raw challenge die. */
export function tackleFoul(defenderRoll: number): boolean;   // === 1

export interface FoulRoll {
  injuryRoll: number;   // raw d<die>
  injured: boolean;     // injuryRoll >= carrierResilience
  cardRoll: number;     // raw d<die>
  booked: boolean;      // cardRoll >= refereeLeniency
  yellows: number;      // fouler's yellow count after this foul (0..2)
  sentOff: boolean;     // yellows >= 2
  rng: Rng;             // after exactly two draws — injury, then card
}

export function resolveFoul(
  rng: Rng,
  carrierResilience: number,
  foulerYellows: number,
  refereeLeniency: number,
  die?: number,         // default 6
): FoulRoll;

/** movePoints lost to injury: 2 when `injured`, else 0. For turn refresh. */
export function pacePenalty(piece: Piece): number;
```

`applyFoul` — the pure state transition — lives in `move-action.ts` (it needs
`MoveActionState` / `TackleOutcome`), sibling of `applyTackle`:

```ts
export function applyFoul(
  state: MoveActionState,
  outcome: TackleOutcome,
  foul: FoulRoll,
): MoveActionState;
```

All pure, deterministic, never mutate. `resolveFoul`'s `rng` advances by exactly
two draws.

## move-action wiring

`resolveTackle`, foul branch (today: phase `foul`, ball unchanged, TODO):

1. `resolveFoul(roll.rng, attrOf(moved, carrier, "resilience"), fouler.yellows ?? 0, moved.refereeLeniency ?? 4, stealDie)`.
2. Apply to a fresh state via `applyFoul(state, outcome, fr)`: carrier (unless
   already `injured`) → `injured: true`, `movePoints: max(0, movePoints - 2)`
   when `fr.injured`; fouler → `yellows: fr.yellows`, `sentOff: fr.sentOff` when
   `fr.booked`. Ball unchanged.
3. Phase `foul` (now awaiting the decision, unless `sentOff`). Snapshot gains
   `foulRoll: FoulRoll | null`; carries the applied state + `fr`.

New event:

```ts
| { type: "foulDecision"; play: boolean }   // foul phase; ignored when sentOff
```

| phase | event | → |
| --- | --- | --- |
| `foul` (not `sentOff`) | `foulDecision` | record `decision = play ? "play" : "stop"`; stay `foul` (terminal marker) |
| `foul` (`sentOff`) | `foulDecision` | no-op — `decision` already `"stop"` |
| `foul` | `selectPiece` / `cancel` | leave to `aiming` / `idle`, as today |

`decision` lives on the snapshot (`"play" | "stop" | null`) — `null` while
awaiting, forced `"stop"` on `sentOff`.

Snapshot: add `foulRoll: FoulRoll | null`, `decision: FoulDecision | null`. Both
cleared by `idleFields` / `selectPiece` / `tackle`.

### `moveView` — replace the thin `foul` marker

```ts
foul: {
  attackerId: string; defenderId: string; at: Cube;
  injury: { roll: number; resilience: number; injured: boolean };
  card: { roll: number; leniency: number; booked: boolean; yellows: number; sentOff: boolean };
  decision: "play" | "stop" | null;   // null = awaiting; "stop" forced on sentOff
} | null;
```

Drop `TODO(foul)`; replace with a pointer to this spec. Free kick / penalty
placement stays the explicit next TODO.

## Tests — `foul.test.ts`

1. fixed seed → known `injuryRoll` / `cardRoll`; `rng` advanced by two `rollDie`
   draws, injury first.
2. injury boundary: `roll === resilience` → `injured`; `roll === resilience - 1`
   → not.
3. card boundary: `roll === refereeLeniency` → `booked`; one below → not.
4. not booked → `yellows` unchanged, `sentOff` false, regardless of prior count.
5. booked with `foulerYellows` 0 → `yellows 1`, not sent off; with 1 → `yellows
   2`, `sentOff`.
6. `pacePenalty`: `2` when `injured`, `0` otherwise.
7. determinism: same args → identical `FoulRoll`.

## Tests — `move-action.test.ts` (`applyFoul`)

- `fr.injured` → carrier `injured` true, `movePoints` down 2 (floor 0); already
  `injured` → `movePoints` untouched, tag stays.
- `fr.booked` → fouler `yellows = fr.yellows`; `fr.sentOff` → `sentOff` true.
- not booked → fouler untouched. Ball hex unchanged. Input state not mutated.

## Tests — `move-action.test.ts` (rewrite the foul case)

- a foul resolves both checks: phase `foul`, `foulRoll` on the snapshot, ball
  unchanged, defender `movePoints` 0 (keep the existing assertion).
- `fr.injured` → carrier `injured` true and `movePoints` down 2; not injured
  → carrier untouched.
- `fr.booked` → fouler `yellows` bumped; second booking → `sentOff` and
  `decision` forced `"stop"`, `foulDecision` a no-op.
- not sent off → `foulDecision { play: true }` → `decision "play"`;
  `{ play: false }` → `"stop"`; still phase `foul`.
- `selectPiece` / `cancel` still leave the `foul` phase.
- replay: a fixed foul seed reproduces `FoulRoll` and the applied tags.
- `refereeLeniency` defaults to 4 when the state omits it.

## Visual

**Skipped** — a foul has no geometry (`resolveFoul` produces no hexes/route),
and `Scenario` has no badge/marker support for "injured" / "carded". The
interactive playground (`actions/movement`, the *reckless challenge* case)
covers it instead — injury glow, card marker, the narrated log line, the
play-on / stop buttons.

## Playground — `actions/movement`

`MovementPlayground` gains `refereeLeniency`; `PlaygroundPiece` gains
`resilience` / `injured` / `yellows`. The inline mirror learns `resolveFoul` /
`applyFoul` and the decision step.

The `tackle` group's existing `foul` seed chip now narrates:
`foul — d6 <i> injury vs resilience <r> → {injured|unhurt} · d6 <c> card vs
leniency <l> → {yellow (n){ · SENT OFF}|no card}`. When not sent off, a
**play on** / **stop (set piece)** button pair shows; clicking logs the decision
and dead-ends with a `TODO` status. Sent off → a "game stopped — set piece"
status, no buttons.

New case **Reckless challenge** (`tackle` group): defender low `tackling` so
seeds reach `foul` easily, carrier low `resilience`, fouler pre-loaded with one
`yellow` so a booking sends him off. Seed chips: *foul · unhurt*, *foul ·
injured*, *foul · sent off*. `movement.playground.test.ts` cross-checks the
baked-seed `FoulRoll` against the real module.

## Done when

- [x] `npm run typecheck && npm test` pass (256 tests).
- [x] `tackleFoul`, `resolveFoul`, `pacePenalty`, `FoulRoll`, `applyFoul`,
  `FoulDecision` re-exported from `src/index.ts`; `foulDecision` event +
  `foulRoll` / `decision` snapshot fields + the widened `moveView.foul` in place.
- [x] `move-action` foul branch applies injury + card via `resolveFoul` /
  `applyFoul`; `TODO(foul)` gone.
- [x] `docs/domain-model.md` (injury line, Foul section, `refereeLeniency`,
  Deferred) + `docs/tackle-action.md` + README updated; `actions/movement` gains
  the *reckless challenge* case — foul chips (*unhurt* / *injured* / *sent off*)
  narrate the checks and show the play-on / stop buttons.

Deviations from the draft: `pace` is not a new attr — it *is* `movePoints`
(user call), so injury docks the carrier's `movePoints` directly and the
`injured` tag persists for a future turn refresh; `effectivePace` became
`pacePenalty`. Both advantage branches (`play` / `stop`) dead-end as TODO
markers — the decision is recorded on the snapshot, phase stays `foul`. The
static visual test was skipped (a foul has no geometry) — see above.
