# Session spec: pass-action (standard ground pass)

Goal: the **ground pass** — the ball carrier kicks the ball to a hex inside a
kick range. Opponents cast a **shadow**: you cannot kick *through* an enemy, so
every hex behind one drops out of the range. Teammates never block. A pass that
travels **next to an opponent** gives that opponent a `d6` interception roll —
a `6` and the ball is picked off. Pure logic, composes the existing lego
(`pixelRangeCubes`, `lineCoverageCubes`, `hexArrow`, `dice`, `move-action`). No
DOM, no timers.

## Placement

New sibling **action** — its own folder, not folded into `move-action` (that
module is large and a pass is not a movement variant):

```
src/pass-action/pass-action.ts        logic + reducer
src/pass-action/pass-action.test.ts
src/pass-action/pass-action.visual.test.ts
```

Reuses from `move-action` (one-way import, no cycle): `MoveActionState`,
`Piece`, `ballCarrier`, `influencers`. `docs/domain-model.md` gains a
**Ground pass** note (today it only lists the lofted `high pass`).

Passing costs no move points — there is no action-point model yet
(`docs/domain-model.md` "Deferred"). One pass per turn is a later concern.

## Rules

| step | rule |
| --- | --- |
| range | `pixelRangeCubes(carrier.at, passRange)` minus the carrier's own hex — the rounded kick disc |
| shadow | a target is **blocked** if `lineCoverageCubes(carrier.at, target)` covers any **opponent**'s hex (endpoints included). Obstacles and teammates never block *(obstacle blocking deferred)* |
| targets | range minus every blocked hex |
| lane | `lineCoverageCubes(carrier.at, target)` — the supercover hexes the ball crosses, both ends |
| flight | the ball flies the **straight** carrier → target line; the lane just orders the interception checks along it (`lane[1]` … target) |
| interception | **one `d6` per opponent for the whole pass** — never more. An opponent rolls the first time the ball reaches a hex their *influence* (6 neighbours) covers, in id order within that hex; flanking several lane hexes still rolls once. `lane[0]` (the carrier) is not a flight hex |
| pick-off | a roll `>= interceptOn` (default `6`) → that opponent takes the ball, flight ends on **their** hex |
| landing | no pick-off and the ball reaches `target`: a piece standing there receives it (`received`); otherwise it rests loose (`loose`) |

`interceptOn` is a **high**-roll threshold (opposite of the `move-action`
steal's `<= stealOn`), matching "if 6 then steals".

## State additions — `MoveActionState`

```ts
passRange?: number;     // kick reach, in adjacent-hex spacings (pixelRangeCubes). default 4
interceptDie?: number;  // interception die. default 6
interceptOn?: number;   // a roll >= this picks the pass off. default 6
```

## Direct functions

```ts
// pixelRangeCubes(carrier.at, passRange) with the carrier hex removed
passRangeCubes(state: MoveActionState, carrierId: string): Cube[];

// lineCoverageCubes(carrier.at, target)
passLane(state: MoveActionState, carrierId: string, target: Cube): Cube[];

// an opponent sits on the lane to `target`
passBlocked(state: MoveActionState, carrierId: string, target: Cube): boolean;

// passRangeCubes minus every passBlocked hex — the legal destinations
passTargets(state: MoveActionState, carrierId: string): Cube[];

// target ∈ passTargets
canPass(state: MoveActionState, carrierId: string, target: Cube): boolean;

// opponents who will get an interception roll on this lane — flank a flight hex
// (lane[1..]). Deduped, sorted by id. (Preview count; the reducer rolls them
// one at a time in flight.)
passInterceptors(state: MoveActionState, carrierId: string, target: Cube): Piece[];

// flight hexes (lane[1..]) an opponent flanks — the risky stretch, for the preview
passThreats(state: MoveActionState, carrierId: string, target: Cube): Cube[];

// solid straight PassArrow — TWO points only, lane[0] → lane[last] (a kick flies
// straight; no corners along the supercover path). Feeds hexArrow /
// Scenario.arrows. null for a <2-hex lane. style overrides the solid blue default.
passArrow(lane: readonly Cube[], style?: ArrowStyle): PassArrow | null;

// ball → dest; the carrier is then whoever stands on dest (ballCarrier), or none.
// Thin — pure state patch. Returns a fresh state.
applyPass(state: MoveActionState, dest: Cube): MoveActionState;
```

```ts
export interface PassArrow extends ArrowStyle { hexes: Cube[]; }   // like MoveArrow
```

- Unknown `carrierId`, or a `carrierId` that is not the current `ballCarrier`,
  throws `RangeError`.
- Pure; never mutates `state` or its cubes.

## Event reducer

```ts
export type PassPhase =
  | "idle" | "aiming" | "passing" | "received" | "loose" | "intercepted";

export type PassActionEvent =
  | { type: "selectPiece"; pieceId: string }   // no-op unless pieceId is the carrier
  | { type: "hoverHex"; hex: Cube | null }
  | { type: "commit"; hex?: Cube }              // defaults to the hovered target
  | { type: "advance" }                         // one lane hex of flight finished animating
  | { type: "cancel" };

export interface PassActionSnapshot {
  state: MoveActionState;
  phase: PassPhase;
  target: Cube | null;
  lane: Cube[];              // to target while aiming; the committed lane in flight
  ballIndex: number;         // lane hexes the ball has travelled (flight)
  rolledIds: string[];       // interceptors already rolled past
  rng: Rng;                  // seeded PRNG; one draw per interception roll
  intercept: InterceptOutcome | null;   // set the frame a pick-off ends the pass
}

export interface InterceptOutcome {
  by: string;                // opponent who took the ball
  at: Cube;                  // their hex — where the flight stopped
  rolls: { id: string; roll: number }[];   // every roll made, in order
}

initPassAction(state: MoveActionState, seed?: number | string): PassActionSnapshot;  // default seed 1
passAction(snap: PassActionSnapshot, event: PassActionEvent): PassActionSnapshot;
passView(snap: PassActionSnapshot): PassActionView;
```

Transitions:

| phase | event | → |
| --- | --- | --- |
| any but `passing` | `selectPiece` (id == carrier) | `aiming`; clears target/lane |
| `aiming` | `hoverHex` h | `canPass` → set `lane`/`target`; else clear |
| `aiming` | `commit` (canPass hex, lane ≥ 2) | `passing`, `ballIndex 0`, `rolledIds []` |
| `passing` | `advance` | ball → `lane[++ballIndex]`; roll each opponent flanking that hex not in `rolledIds` (id order), append to `rolledIds`; a roll `>= interceptOn` → `intercepted`, `applyPass(opp.at)`, flight ends. Reached the target with no hit → `applyPass(target)`, then `received` (a piece is on target) or `loose` |
| not `passing` | `cancel` | `idle` |

Anything else (wrong phase, unknown/non-carrier piece, unreachable
`commit`/`hoverHex`) returns the snapshot **unchanged**. `passAction` never
mutates `snap`. `received` / `loose` / `intercepted` are dead ends — leave via
`selectPiece` or `cancel`.

```ts
export interface PassActionView {
  phase: PassPhase;
  carrier: Piece | null;             // the passer (null once the ball has left)
  pieces: readonly Piece[];
  ball: Cube | null;
  targets: Cube[];                   // legal destinations — [] unless aiming
  blocked: Cube[];                   // in-range hexes dropped by a shadow — [] unless aiming (for a greyed overlay)
  target: Cube | null;
  lane: Cube[];
  arrow: PassArrow | null;           // passArrow(lane)
  threats: Cube[];                   // flight hexes an opponent flanks — mark these on aim
  // one lane hex of flight (passing only). Animate from→to, dispatch `advance`,
  // repeat until null. `contest` = ids rolled as the ball reached `to`.
  step: { from: Cube; to: Cube; index: number; count: number; contest: string[] } | null;
  intercept: InterceptOutcome | null;
  receiver: string | null;           // `received` only — the teammate who collected it
}
```

### Consumer sketch

```ts
let s = initPassAction({ pieces, obstacles: [], ball, passRange: 4 }, "match-7");
s = passAction(s, { type: "selectPiece", pieceId: ballCarrier(s.state)!.id });
// passView(s).targets → highlight; .blocked → grey the shadow
s = passAction(s, { type: "hoverHex", hex: h });
// passView(s).threats → pulse the risky lane hexes red
s = passAction(s, { type: "commit", hex: h });
while (passView(s).step) {
  const { from, to } = passView(s).step!;
  await runAnimation(movePiece(from, to));
  s = passAction(s, { type: "advance" });
}
const v = passView(s);
if (v.intercept) { /* picked off */ } else if (v.phase === "received") { /* v.receiver has it */ }
```

## Tests — `pass-action.test.ts`

**range / shadow**
1. lone carrier, `passRange 4` → `passTargets` == `passRangeCubes` (carrier hex excluded), a known count.
2. one opponent 2 hexes out → every hex whose lane covers the opponent hex is gone from `passTargets`; hexes to the side stay.
3. a **teammate** in the same spot blocks nothing — `passTargets` unchanged vs case 1.
4. opponent's own hex is never a target (its lane endpoint holds it).
5. `passBlocked` true through an enemy, false past a teammate; `canPass` agrees with `passTargets` membership.

**lane / arrow**
6. `passLane` == `lineCoverageCubes(carrier.at, target)`, carrier first.
7. `passArrow` → solid straight, `hexes` = `[lane[0], lane[last]]` (two points, no
   corners); `null` when carrier == target.

**interceptors**
8. `passInterceptors` = opponents adjacent to a flight hex (`lane[1..]`), deduped, id-sorted; an opponent adjacent only to `lane[0]` is **not** listed.
9. `passThreats` = the flight hexes those opponents flank.

**reducer flow**
10. `selectPiece` non-carrier / `selectPiece` unknown → no-op; carrier → `aiming`.
11. `hover → commit → advance*` lands the ball; `commit` with `hex` skips hover; blocked `commit` / `hoverHex` → no-op.
12. clean lane → phase `loose` on an empty target, `received` + `receiver` on a teammate target; `applyPass` moved the ball, `ballCarrier` follows.
13. `cancel` → `idle`; no `cancel` mid-`passing`.

**interception**
14. seed rolling a `6` next to the lane → `intercepted`, ball on that opponent, flight stopped there, `intercept.rolls` recorded.
15. one roll per flanking opponent, id order, first `>= interceptOn` wins; `rng` advances one draw per roll.
16. an opponent flanking two lane hexes rolls once (`rolledIds`).
17. a calm seed completes the pass; `interceptOn` lowered to `1` picks it off immediately.
18. determinism: a fixed seed replays the whole pass — rolls, interceptor, landing.

## Visual — `pass-action.visual.test.ts`

`writeScenario("pass-action", "<case>", s)`, carrier in `player`, opponents in
`obstacle` *(colour reuse for contrast — note it in the title)* or a second
`player` entry, `reachable` = `passTargets`, `goal` = `threats`,
`lines`/`arrows` for a chosen lane:

| case | shows |
| --- | --- |
| `range` | lone carrier — the full rounded kick disc |
| `shadow` | one opponent mid-range — the wedge of blocked hexes behind it removed |
| `through-teammate` | a teammate on a long lane — target still legal, range behind intact |
| `lane` | a picked target: `passLane` + the raw segment guide + `passArrow` |
| `threats` | a lane skimming two opponents — the flanked flight hexes marked, arrow reddened |
| `crowd` | carrier ringed by 2 opponents + 2 teammates — targets, shadow and threats together |
| `offset` | non-origin carrier |

## Playground — `actions/passing`

`src/test-utils/pass-playground.ts` (`writePassPlayground(slug, label, blurb,
cases)`) → one self-contained page at `scenarios/actions/passing/index.html`.

- **Baked, not mirrored.** Every hex geometry (kick range, shadow, lane,
  per-lane interceptor list + the flight index each is first reached at) is
  computed from the real `pass-action` module at generation time and embedded in
  the case data. The inline script only rolls the seeded `d6` (mulberry32,
  matching `src/dice`) and animates the ball — no hex-math re-implementation to
  drift.
- Click the piece on the ball to arm it — `targets` fill blue, shadowed in-range
  hexes go grey. Hover a target: the **two-point** straight arrow + `threats`
  pulse (red when a defender flanks the lane). Click to kick — the ball flies
  the **straight** arrow (carrier → target, ~150 ms per hex of distance); each
  flanking opponent rolls once as the ball passes its fraction of the line, and a
  `>= interceptOn` pick-off diverts the ball off the line to that opponent. The
  `.log` line narrates:
  `pass — {loose ball | received by B | intercepted by D}  ·  d6 …`.
- `reset` replays the seed, `shuffle` rolls a fresh one.
- Cases (`pass-action.playground.test.ts`): *open pass*, *thread it past a
  defender*, *into a crowd*, *no lane — boxed in*. The test cross-checks the
  baked targets / lanes / interceptor lists against the module, and replays the
  inline roll loop vs the real reducer over many seeds.

## Done when

- [x] `npm run typecheck && npm test` pass (294 tests).
- [x] `pass-action` API re-exported from `src/index.ts` (`initPassAction`,
  `passAction`, `passView`, `passTargets`, `passLane`, `passBlocked`, `canPass`,
  `passInterceptors`, `passThreats`, `passArrow`, `applyPass`, `passRangeCubes`
  + the types).
- [x] `scenarios/utilities/pass-action/` renders every static case
  (`range`, `shadow`, `through-teammate`, `lane`, `threats`, `crowd`, `offset`);
  `scenarios/actions/passing/` plays through.
- [x] `docs/domain-model.md` "Ground pass" note + README "Layout" + "Visual
  scenarios" + "Planned utilities" updated.

Deviations from the draft: `passArrow` emits **two points only** (start → end, no
corners along the supercover path); `PassRoll` / `PassStep` types added; the
snapshot carries a running `rolls` list (not only the final `intercept.rolls`) so
a completed pass still exposes the misses; the playground **bakes** module output
rather than mirroring the hex math inline; seed chips dropped in favour of plain
`reset` / `shuffle`.
