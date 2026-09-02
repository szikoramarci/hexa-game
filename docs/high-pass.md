# Session spec: high-pass (lofted pass + aerial challenge)

Goal: the **high pass** — the carrier lofts the ball to a hex a chosen teammate
runs onto. Range is a long rounded disc; only opponents **next to the carrier**
shadow it. Once the landing hex is locked, the receiver, one opponent, and (in
the box) the keeper get reaction moves; then the passer rolls for accuracy
(`d6 + highPass >= 8`), a miss scatters the ball with `looseBall`. Wherever it
lands, everyone around contests a **header**. Pure logic, composes the existing
lego. No DOM, no timers.

## Placement

New sibling **action**, its own folder (like `pass-action` — not folded into it):

```
src/high-pass/high-pass.ts        logic + reducer
src/high-pass/high-pass.test.ts
src/high-pass/high-pass.visual.test.ts
src/high-pass/high-pass.playground.test.ts
```

One-way imports (no cycle): `MoveActionState` / `Piece` / `ballCarrier` /
`influencers` / `blockersFor` / `resolveChallenge` from `move-action`;
`looseBall` from `loose-ball`; `pixelRangeCubes`, `lineCoverageCubes`,
`cubeDistance`, `reachableCubes`, `pathCubes`, `hexArrow`, `dice`.
`docs/domain-model.md` "Passing" gains a **High pass** subsection.

Costs no move points (no action-point model yet).

## Type changes

```ts
export interface Piece {
  // ...existing
  /** Kit role. Drives which aerial attr a header uses, and the keeper rule. Default "outfield". */
  role?: "outfield" | "goalkeeper";
  attrs?: {
    dribbling?: number; tackling?: number; resilience?: number;
    heading?: number;   // outfield aerial contest, 1..6
    aerial?: number;    // goalkeeper aerial contest, 1..6 ("aerial ability")
    highPass?: number;  // lofted-pass accuracy, 1..6
  };
}

export interface MoveActionState {
  // ...existing
  highPassRange?: number;       // pixelRangeCubes reach, default 8
  highPassAccuracyOn?: number;  // d6 + highPass >= this is accurate, default 8
  penaltyArea?: readonly Cube[];// hexes tagged penaltyArea (both boxes). default []
}
```

`attrOf`'s key union widens to `heading | aerial | highPass` (same
`?? defaultAttr ?? 3` fallback). Add a small `aerialAttr(state, piece)` =
`piece.role === "goalkeeper" ? attrOf(…, "aerial") : attrOf(…, "heading")`.

## Rules

### Aim — range, min distance, shadow

| step | rule |
| --- | --- |
| disc | `pixelRangeCubes(carrier.at, highPassRange)` — the rounded long-ball reach |
| min distance | drop every hex with `cubeDistance(carrier.at, h) < 4` — a loft clears the first three rings (carrier hex included) |
| shadow | only opponents at `cubeDistance(carrier.at, opp.at) === 1` shadow. A landing hex is **blocked** when `lineCoverageCubes(carrier.at, h)` covers such an adjacent opponent's hex — you cannot loft *through* a man on top of you. Non-adjacent opponents, teammates, obstacles never block |
| landing zone | disc − min-distance − shadowed hexes |
| receiver | a teammate of the carrier (not the carrier) that has **at least one legal target** — one it can run to in the zone. A teammate the shadow shuts out of the zone entirely, even after its 3-hex run, is not selectable |
| targets | landing zone ∩ `reachableCubes(receiver.at, 3, blockersFor(receiver))` — the hexes the receiver can actually **run to** in 3 steps, with every other piece and obstacle blocking the run (its own hex kept). Reactions have not happened yet, so this is the snapshot the receiver runs in |

`canHighPass` = target ∈ targets for that receiver.

### Reactions — after the landing hex is locked

An ordered queue; each slot is one reaction move, resolved by the controller
(`reactMove` hex within budget, or `reactSkip`). A move is `pathCubes` within
`budget` around `blockersFor(reactor)`; applied at once (the view carries the
path for animation).

| # | slot | piece | budget |
| --- | --- | --- | --- |
| 1 | receiver | the chosen teammate | 3 |
| 2 | opponent | one opponent, `reactPiece` picks which (defaults to none → `reactSkip` only) | 3 |
| 3 | keeper | defending `role: "goalkeeper"`, **only if landing ∈ `penaltyArea`** | `1`, or `4` when `cubeDistance(keeper.at, landing) <= 5` |

- Keeper budget is **1 or 4, never combined** with slot 2 — the keeper's move is
  its own; it is not also the slot-2 opponent.
- No keeper on the board, or landing outside the box → slot 3 is absent.
- Reactions do **not** roll a steal / interception; they are pure repositioning.

### Accuracy

Passer rolls `d6`. `roll + attrOf(carrier, "highPass") >= highPassAccuracyOn`
(default 8) → **accurate**: the ball flies to the locked landing hex.

Otherwise **inaccurate**: `looseBall(rng, landing, [], die?)` — scatter from the
landing hex (empty `stoppers`; the ball is in the air, nobody "catches" it
mid-flight). The header contest happens at `scatter.rest`.

`die` = `state.stealDie ?? 6` (the project's shared d6 knob), matching
`pass-action` / tackle.

### Header contest

Ball arrives at `landing` (accurate) or `scatter.rest` (miss). Every piece by
ring:

| `cubeDistance(p.at, ballHex)` | in the contest? | attr |
| --- | --- | --- |
| 0 | yes | `aerialAttr(p)` |
| 1 | yes | `aerialAttr(p)` |
| 2 | yes | `aerialAttr(p) - 1` |
| ≥ 3 | no | — |

Each contestant rolls `d6`; score = `roll + attr`. **Highest score wins.**

- Tie for the top score, or **nobody** in range → no winner, ball **loose** on
  the arrival hex (`phase: "loose"`). (A multi-way header scramble is out of
  scope; treat it as spilled.)
- A winner → `phase: "headed"`, terminal for this session. The follow-up
  (headed pass vs headed shot) reads `winner` + arrival hex later.

Contest roll order = by ascending `cubeDistance` to the ball, then by id, so a
seed replays. `rng` advances one draw per contestant.

## Direct functions

```ts
highPassRangeCubes(state, carrierId): Cube[];   // disc − carrier − min-distance
highPassShadow(state, carrierId): Cube[];        // hexes of carrier-adjacent opponents
highPassBlocked(state, carrierId, target): boolean;
highPassLandingZone(state, carrierId): Cube[];   // range − shadow
highPassReceivers(state, carrierId): Piece[];    // teammates with >= 1 target, id-sorted
highPassTargets(state, carrierId, receiverId): Cube[];   // zone ∩ receiver's reachableCubes(3)
canHighPass(state, carrierId, receiverId, target): boolean;

// lofted 2-hex jump arc: hexArrow shape "curved", [carrier.at, target]
highPassArrow(from: Cube, to: Cube, style?: ArrowStyle): HighPassArrow | null;

// reachable hexes for a reactor with `budget`, around blockersFor(reactorId), own hex dropped
reactReach(state, reactorId, budget): Cube[];

// the header roster at `ballHex`: { id, dist, attr, reduced }[] — dist∈{0,1,2}, id-sorted within dist
headerContestants(state, ballHex): HeaderEntry[];

applyHighPass(state, dest: Cube): MoveActionState;   // ball → dest (thin patch, like applyPass)
```

- Unknown / non-carrier `carrierId`, non-teammate `receiverId` → `RangeError`.
- Pure; never mutates `state` or its cubes.

## Event reducer

```ts
export type HighPassPhase =
  | "idle" | "receiver" | "aiming" | "reacting" | "rolling"
  | "flight" | "headed" | "loose";

export type HighPassEvent =
  | { type: "selectPiece"; pieceId: string }    // carrier → "receiver"
  | { type: "selectReceiver"; pieceId: string } // teammate → "aiming"
  | { type: "hoverHex"; hex: Cube | null }
  | { type: "commit"; hex?: Cube }              // lock landing → "reacting"
  | { type: "reactPiece"; pieceId: string }     // pick the slot-2 opponent
  | { type: "reactMove"; hex: Cube }            // move the current reactor
  | { type: "reactSkip" }                       // current reactor stays
  | { type: "advance" }                         // roll accuracy · step the arc · resolve header
  | { type: "cancel" };

export interface HighPassSnapshot {
  state: MoveActionState;
  phase: HighPassPhase;
  receiverId: string | null;
  target: Cube | null;            // locked landing hex
  reactions: ReactionSlot[];      // built at commit
  reactionIndex: number;
  accuracy: AccuracyRoll | null;  // set on the accuracy roll
  scatter: LooseBallRoll | null;  // set only on a miss
  arrivalHex: Cube | null;        // target or scatter.rest
  flightIndex: number;            // arc animation ticks done
  header: HeaderOutcome | null;   // set when the contest resolves
  rng: Rng;
}

export interface ReactionSlot {
  role: "receiver" | "opponent" | "keeper";
  pieceId: string | null;        // null = unset opponent slot
  budget: number;
  path: Cube[] | null;           // filled once resolved (for the view/animation)
}

export interface AccuracyRoll { roll: number; attr: number; score: number; accurate: boolean; }

export interface HeaderEntry { id: string; dist: 0 | 1 | 2; attr: number; reduced: boolean; }
export interface HeaderRoll extends HeaderEntry { roll: number; score: number; }
export interface HeaderOutcome {
  at: Cube;
  rolls: HeaderRoll[];           // contest order
  winner: string | null;         // null = tie / nobody → loose
}

initHighPass(state, seed?): HighPassSnapshot;   // default seed 1
highPassAction(snap, event): HighPassSnapshot;
highPassView(snap): HighPassView;
```

### Transitions

| phase | event | → |
| --- | --- | --- |
| any but `flight` | `selectPiece` (== carrier) | `receiver`; clear everything downstream |
| `receiver` | `selectReceiver` (a teammate) | `aiming`; set `receiverId` |
| `aiming` | `hoverHex` h | `canHighPass` → set `target`; else clear |
| `aiming` | `commit` (canHighPass hex) | build `reactions`, `reactionIndex 0` → `reacting` |
| `reacting` | `reactPiece` (opponent, current slot is the unset opponent) | set `slot.pieceId` |
| `reacting` | `reactMove` h (h ∈ `reactReach` of the current reactor) | apply move, `slot.path`, `reactionIndex++`; queue done → `rolling` |
| `reacting` | `reactSkip` | `slot.path = [reactor.at]`, `reactionIndex++`; queue done → `rolling` |
| `rolling` | `advance` | roll `d6` accuracy. accurate → `target` is `arrivalHex`; miss → `looseBall` from `target`, `scatter.rest` is `arrivalHex`. → `flight`, `flightIndex 0` |
| `flight` | `advance` | tick the arc; last tick → resolve `headerContestants(arrivalHex)`, roll each, set `header`; `applyHighPass(arrivalHex)`; → `headed` (winner) or `loose` (tie / empty) |
| not `flight` | `cancel` | `idle` |

Anything else (wrong phase, non-carrier / non-teammate / non-opponent piece,
unreachable hex, `reactPiece` when the current slot is not the unset opponent)
returns the snapshot **unchanged**. `highPassAction` never mutates `snap`.
`headed` / `loose` are dead ends — leave via `selectPiece` or `cancel`.

`reactPiece` candidates: any opponent of the carrier. The keeper *may* be picked
as the slot-2 opponent only if it is not also going to fill slot 3 — simplest:
exclude the defending keeper from slot-2 candidates whenever slot 3 exists.

### View

```ts
export interface HighPassView {
  phase: HighPassPhase;
  carrier: Piece | null;            // null once the ball has left
  pieces: readonly Piece[];
  ball: Cube | null;
  receivers: Piece[];               // "receiver" phase only
  receiver: Piece | null;
  targets: Cube[];                   // "aiming" only — legal landing hexes for the receiver
  blocked: Cube[];                   // in-range hexes dropped by a shadow — greyed overlay, "aiming" only
  shadow: Cube[];                    // carrier-adjacent opponent hexes casting it
  target: Cube | null;
  arrow: HighPassArrow | null;       // highPassArrow(carrier.at, target)
  reaction: {                        // "reacting" only
    role: "receiver" | "opponent" | "keeper";
    piece: Piece | null;
    budget: number;
    reach: Cube[];                   // reactReach — [] until an opponent is picked
    needsPiece: boolean;             // true = waiting on reactPiece
    candidates: Piece[];             // opponent picks, id-sorted
  } | null;
  accuracy: AccuracyRoll | null;
  scatter: (LooseBallRoll & { from: Cube }) | null;
  arrival: Cube | null;
  step: { from: Cube; to: Cube; index: number; count: number } | null;  // arc tick, "flight" only
  header: HeaderOutcome | null;
  contestants: HeaderEntry[];        // preview once `arrivalHex` is known
}
```

Arc `count` = `cubeDistance(carrier.at, arrivalHex)`; the renderer draws the ball
at `index / count` along the straight `carrier → arrival` chord with a hop, like
`pass-action`'s straight-flight timing.

### Consumer sketch

```ts
let s = initHighPass({ pieces, obstacles: [], ball, penaltyArea, highPassRange: 8 }, "m7");
s = highPassAction(s, { type: "selectPiece", pieceId: carrier.id });
s = highPassAction(s, { type: "selectReceiver", pieceId: mate.id });
s = highPassAction(s, { type: "hoverHex", hex: h });     // view.targets highlighted
s = highPassAction(s, { type: "commit", hex: h });
while (highPassView(s).reaction) {
  const r = highPassView(s).reaction!;
  if (r.needsPiece) s = highPassAction(s, { type: "reactPiece", pieceId: pickFoe() });
  else s = highPassAction(s, { type: "reactMove", hex: pickHex(r.reach) });  // or reactSkip
}
s = highPassAction(s, { type: "advance" });              // accuracy roll
while (highPassView(s).step) s = highPassAction(s, { type: "advance" });
const v = highPassView(s);
// v.phase "headed" → v.header.winner has it;  "loose" → ball spilled on v.arrival
```

## Tests — `high-pass.test.ts`

**range / min distance / shadow**
1. lone carrier, `highPassRange 8` → `highPassRangeCubes` = the disc minus every
   hex within `cubeDistance < 4`; a known count; carrier hex absent.
2. opponent adjacent to the carrier → hexes whose lane covers it are gone from
   `highPassLandingZone`; side hexes stay. An opponent **2** hexes from the
   carrier on the same line blocks **nothing**.
3. a teammate adjacent to the carrier blocks nothing.
4. `highPassBlocked` true through an adjacent enemy, false otherwise.

**receiver / targets**
5. `highPassReceivers` = the carrier's teammates **with a legal target**,
   id-sorted, carrier excluded. A teammate whose whole run stays in the shadow is
   dropped; the reducer's `selectReceiver` then refuses it. A teammate standing
   in the shadow but able to run clear stays — its targets are the clear hexes.
6. `highPassTargets` = landing zone ∩ the receiver's `reachableCubes(3)`; a
   receiver far from the zone → `[]`; a receiver walled in by other pieces loses
   the hexes it can no longer run to.
7. `canHighPass` agrees with `highPassTargets` membership; non-teammate
   `receiverId` → `RangeError`.

**reactions**
8. `commit` builds slots `[receiver(3), opponent(3)]` when the landing hex is
   outside `penaltyArea`; inside it with a defending keeper → a third
   `keeper` slot, budget `1`, or `4` when `cubeDistance(keeper.at, landing) <= 5`.
9. `reactPiece` sets the opponent; `reactMove` to a `reactReach` hex moves the
   reactor and advances; `reactSkip` advances without moving; out-of-reach
   `reactMove` → no-op.
10. keeper slot absent when no keeper / landing outside the box.

**accuracy**
11. seed where `d6 + highPass >= 8` → `accurate`, `arrivalHex === target`.
12. seed where it fails → `scatter` set, `arrivalHex === scatter.rest`,
    `looseBall` called with empty stoppers (rest is direction/distance only).
13. `highPassAccuracyOn` lowered to `2` → always accurate; raised to `13` →
    always a miss.

**header**
14. `headerContestants` at a hex: pieces at dist 0/1 full attr, dist 2 `attr-1`
    (`reduced: true`), dist ≥ 3 absent; keeper entry uses `aerial`, outfield uses
    `heading`.
15. contest rolls in ascending-distance then id order; highest score wins →
    `phase "headed"`, `header.winner` set, ball on the arrival hex.
16. a tie for top score → `phase "loose"`, `winner null`, ball loose on arrival.
17. nobody within 2 hexes → `phase "loose"` straight away, no rolls.

**reducer flow / determinism**
18. `selectPiece` non-carrier / `selectReceiver` non-teammate → no-op; full happy
    path walks `idle→receiver→aiming→reacting→rolling→flight→headed`.
19. `cancel` → `idle` from every phase except `flight`.
20. a fixed seed + fixed events replays the whole action — reactions, accuracy,
    scatter, every header roll, the winner — identically.

## Visual — `high-pass.visual.test.ts`

`writeScenario("high-pass", "<case>", s)` — carrier in `player`, opponents in a
second `player` / `obstacle` (note the colour reuse), `reachable` = the relevant
hex set, `goal` = shadow or contestant hexes, `arrows` for the loft:

| case | shows |
| --- | --- |
| `range` | lone carrier — the long disc with the inner 3 rings cut out |
| `shadow` | one adjacent opponent — the blocked wedge removed; a 2-away opponent that does *not* block |
| `receiver` | a picked teammate — the landing zone narrowed to its 3-hex run circle |
| `loft` | a chosen landing hex — `highPassArrow` jump arc + the receiver run circle |
| `box` | landing in the penalty area — keeper slot, the `<=5` challenge radius |
| `header` | ball arrival — the 0/1 (full) and 2 (reduced) contestant rings |
| `scatter` | an inaccurate loft — `looseBall` route from the target to `rest`, header ring there |

## Playground — `actions/high-pass`

`src/test-utils/high-pass-playground.ts` (`writeHighPassPlayground(slug, label,
blurb, cases)`) → `scenarios/actions/high-pass/index.html`. **Baked** like
`pass-playground`: every hex set (disc, shadow, landing zone, per-receiver
targets, reaction reach, header rings) comes from the real module at generation
time; the inline script only rolls the seeded `d6` and animates the arc.

Flow: click the carrier → teammates glow, click one → landing zone fills, hover
for the arc, click to lock. **Right-click** steps the selection back (aiming →
receiver → idle). The chosen receiver then **walks** (hex-by-hex, `move-piece`
style) onto the landing hex, routed around the other players; manual only if it
is boxed in. The remaining reactions in turn: the reactor glows, its reach fills
(opponent slot first asks you to click an opponent), click a hex — the piece
walks there — or a **skip** button. Then **kick** — accuracy `d6` logs
`high pass — d6 r + highPass a = s → {accurate | wide, scatters d6/d6}`; the ball
arcs to the arrival hex; the header rolls list
`header — B d6+3=9 · D d6+2(-1)=7 → B wins` (or `→ loose`). `reset` replays,
`shuffle` re-seeds.

Cases (`high-pass.playground.test.ts`, cross-checked vs the module + a
multi-seed reducer round-trip): *switch of play* (open loft, receiver runs on),
*lofted over a marker* (adjacent opponent shadow), *cross into the box* (keeper +
defenders contest), *miss under pressure* (low `highPass`, scatter + scramble),
*pick a runner* (three teammates ahead — choose which one to hit),
*blocked — a marker shuts a teammate out* (an adjacent opponent's shadow covers
every hex that teammate could run to — it is not selectable, hit the other one),
*shadow clips the run* (the marker's wedge cuts across the near side of a
selectable teammate's run — part of its landing circle is blue, part greys out).

The receiver-phase paint dims shut-out teammates and greys the shadow casters;
the aiming paint fills the receiver's reachable landing hexes blue and greys the
slice of its run the shadow covers. Penalty-area hexes are drawn yellow (the
keeper only reacts to a loft landing on one).

## Done when

- [x] `npm run typecheck && npm test` pass (337 tests).
- [x] `high-pass` API re-exported from `src/index.ts` (`initHighPass`,
  `highPassAction`, `highPassView`, `highPassRangeCubes`, `highPassShadow`,
  `highPassBlocked`, `highPassLandingZone`, `highPassReceivers`,
  `highPassTargets`, `canHighPass`, `highPassArrow`, `reactReach`,
  `headerContestants`, `applyHighPass` + the types).
- [x] `Piece.role` + the `heading` / `aerial` / `highPass` attrs + the three
  `MoveActionState` fields added.
- [x] `scenarios/utilities/high-pass/` renders every static case;
  `scenarios/actions/high-pass/` plays through.
- [x] `docs/domain-model.md` "Passing → High pass" + README "Layout" / "Visual
  scenarios" / "Planned utilities" updated.

Deviations from the draft:

- **`attrOf` not widened** — `move-action`'s `attrOf` is private and unused for
  these keys, so `high-pass` reads attrs through its own local `attr` /
  `aerialAttr` helpers (fallback `defaultAttr ?? 3`).
- **Keeper "not combinable"** read as: the keeper's own move is `1` or `4`, never
  `1` stacked with `3`; and the keeper is dropped from the slot-2 opponent
  candidates whenever it has a slot-3 move.
- **`highPassArrow(from, to)`** emits a two-hex `curved` jump arc (no `lane`
  array — a loft has no supercover path to trace).
- **Header contest** is a many-way highest-roll resolved inline in
  `resolveHeader` (not `resolveChallenge`, which is 1v1).
- **`highPassTargets`** gates on `reachableCubes(receiver.at, 3, blockersFor)` —
  the hexes the receiver can actually run to, other players blocking — not a raw
  `cubeDistance <= 3`. **`highPassReceivers`** then drops any teammate with no
  target (the shadow covers its whole run), so a shut-out teammate cannot be
  selected.
- Reducer reaction moves apply at once with the route on `slot.path`. The
  **playground** walks every reaction piece hex-by-hex (`move-piece` style) and
  auto-resolves the receiver slot by running it onto the landing hex (routed
  around the others); the reducer keeps `reactMove` free — a caller can send the
  receiver elsewhere. Right-click in the playground steps the selection back.
- Snapshot also carries `origin` (the arc's start); the flight `step` is a single
  `from → to` arc with an `index / count` clock, not consecutive lane hexes.

## Open / deferred

- **Header follow-up** — headed pass vs headed shot, and the "a header cannot be
  followed by another header" chain limit (`docs/domain-model.md` "Ball → In the
  air"). This session stops at `winner`.
- **Multi-way header tie** — spilled as a loose ball for now; a real aerial
  scramble (re-contest, knock-downs) is later.
- **Pitch model** — `penaltyArea` is an explicit cube list on the state, like
  `obstacles`, until the pitch builder lands.
- **`resolveChallenge` reuse** — the header is a *many*-way highest-roll contest,
  not the 1v1 `resolveChallenge`; if a second many-way contest appears, factor a
  shared helper.
- Field edges / goals on a scatter — still the rules layer's job (`looseBall`).
