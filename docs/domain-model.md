# Domain model: football on a hex grid

Context for the lego parts, not a spec. No implementation yet. Rules that read
this model come in later phases.

## Entities

### Ball

Position only. State = the hex it's on. No attributes.

- **Carried** — a player stands on the ball's hex (`ballCarrier`, already in
  `move-action`). The carrier and ball move together.
- **Loose** — no player on the hex; the ball is rolling / sitting. Comes from a
  drawn challenge (see below), a missed pass, a rebound.
- **In the air** — after a high pass or a header. The next legal contest is a
  header / aerial, not a ground action. Chain limit: a header cannot be followed
  by another header. Resolved back to carried / loose / dead by the situation.
  The high pass is implemented (`high-pass`, below); it resolves to `headed` (a
  contestant won the aerial) or `loose`. The headed pass / headed shot that
  follows a win is the next session.

### Players

Position + `team` + `role` + attributes. All attributes are integers `1..6`,
**except pace which is `3..6`**.

Two roles, different kit colour, different attribute sets:

| role | attributes |
| --- | --- |
| `outfield` | pace, tackling, heading, shooting, high pass, dribbling, resilience |
| `goalkeeper` | pace, handling, saving, aerial ability, high pass, dribbling, resilience |

Notes:

- `aerial ability` (GK) and `heading` (outfield) are near-equivalents under
  different names — a GK's aerial ability is contested against an outfielder's
  heading. Kept as distinct attributes for now; details later.
- `saving` (GK) is contested against `shooting`.
- `tackling` also applies to a goalkeeper **when outside their penalty area**.
- `high pass` = making an accurate lofted pass (offense only for now).
- `resilience` = injury resistance. A foul rolls `d6` vs `resilience`; `>=` and
  the player is `injured` — `-2` move points, and it sticks. See `docs/foul.md`.
- `pace` is the piece's `movePoints` (the per-turn travel budget), not a
  separate stat.

### Teams

Two teams. `team` is a tag on the player (e.g. `teamA` / `teamB`), same style as
a field tag — see the open question on relative vs absolute below.

## Field

Each hex carries a set of **tags** (flags). Tags are dumb data for now — **no
behaviour attached**; the rules layer (later phase) reads them.

Fixed-size pitch for now. A pitch builder can generate the geometric tags;
spots and areas are placed.

### Tags

One exclusive axis — the ball's in/out status:

- `inPlay` · `sideline` (still in play, last row) · `outOfField` (beyond — a
  throw-in / goal kick / corner by rule)

Everything else stacks freely:

- `goalLine` · `goal` · `penaltyArea` · `penaltySpot` · `goalArea`
- `centreSpot` · `centreCircle`
- thirds: `teamAThird` · `centreThird` · `teamBThird`
- halves: `teamAHalf` · `teamBHalf`
- `cornerFlag`

Example reads (rules, later): ball on `sideline` → in play; ball on `outOfField`
→ throw-in; ball on `goalLine` → not a goal; ball on `goal` → goal; foul on a
`penaltyArea` hex → penalty taken from the `penaltySpot` hex.

**Open:** absolute (`teamAThird`) vs relative (`ownThird` / `attackingThird`).
Leaning toward keeping tags absolute and deriving the relative view per team at
query time, but not decided. Offside etc. need the relative view.

## Challenges

Contest between two attributes, resolved with dice (`src/dice`, seeded,
replayable). There are several challenge types; each pairs specific attributes
and may resolve differently. Details to be added per situation.

Known so far:

| challenge | attacker | defender |
| --- | --- | --- |
| tackle | dribbling | tackling |
| shot / save | shooting | saving |
| aerial | heading | aerial ability |

**Tackle** resolution: `d6 + dribbling` (attacker) vs `d6 + tackling`
(defender).

- defender higher → defender wins the ball
- attacker higher → attacker keeps it
- **tie → loose ball**

The existing `move-action` ball-steal (`d6 <= stealOn`) is a simpler
placeholder; it will fold into this model.

The tackle challenge is implemented — `resolveChallenge` (generic `d6 + attr`)
plus the defender lunge, in `move-action`. See `docs/tackle-action.md`. A tie
scatters the ball (below); a foul runs the referee checks (below).

### Foul

The defender's raw challenge `d6` of `1` is a foul: the comparison is void, the
carrier keeps the ball, and the referee steps in with two `d6` checks (always
both):

- **injury** — `d6 >= carrier.resilience` → the carrier is `injured` (`-2` move
  points, persists).
- **card** — `d6 >= refereeLeniency` → a yellow for the fouler; his second is a
  red (`sentOff`), which stops the game.

`refereeLeniency` is a global on `MoveActionState`, `3..6`, rolled once at
kick-off (default `4`). After the checks the attacking controller picks
`play` on (advantage) or `stop` for the set piece — both still TODO, as is
performing the free kick / penalty. Implemented as `resolveFoul` in `src/foul/`
plus `applyFoul` / the `foulDecision` event in `move-action`. See
`docs/foul.md`.

### Loose ball scatter

When a challenge draws (or a rule calls for it):

1. `d6` → direction (one of the six hex directions)
2. `d6` → distance in hexes
3. The ball travels that far and comes to rest, unless something on the way
   changes it:
   - rolls onto a player's hex → that player picks it up (becomes carrier)
   - crosses `goal` / `outOfField` / etc. → the rules layer decides
     (goal, throw-in, ...)

Implemented as `looseBall(rng, origin, stoppers, die?)` in `src/loose-ball/`,
wired into `move-action`'s tie branch. The origin hex never stops the ball (the
just-tackled carrier stands there). Field edges / goals are still deferred —
the ball may roll off the board and the rules layer reads `rest`'s tags later.
See `docs/loose-ball.md`.

### Pickup

A player moving through a hex that has a loose ball on it picks it up and
carries it from there.

## Passing

### Ground pass

The carrier kicks the ball along the ground to a hex in range.

- **range** — a rounded kick disc, `pixelRangeCubes(carrier.at, passRange)`.
- **shadow** — you cannot kick *through* an opponent: a target is illegal when
  the straight lane (`lineCoverageCubes`) to it covers an enemy hex, so every hex
  behind a defender drops out. Teammates never block (you may pass past or to
  them). Obstacle blocking is deferred.
- **interception** — as the ball rolls the lane, each opponent whose influence
  (its six neighbours) covers a flight hex rolls one `d6` the first time the ball
  comes adjacent; `>= interceptOn` (default `6`, a *high* threshold — unlike the
  `move-action` steal's `<= stealOn`) picks the pass off and the ball stops on
  that opponent.
- **landing** — clear to the target: a piece there receives it, otherwise it
  rests loose (`docs/loose-ball.md` scatter is not used for a completed pass).

Implemented as `pass-action` — direct fns + an event reducer, a sibling to
`move-action`. Costs no move points (no action-point model yet). See
`docs/pass-action.md`.

### High pass

The carrier lofts the ball to a hex a chosen teammate runs onto.

- **range** — a long rounded disc, `pixelRangeCubes(carrier.at, highPassRange ??
  8)`, minus every hex closer than 4 (a loft clears the carrier hex and the first
  three rings).
- **shadow** — only opponents standing *next to the carrier* block: a landing hex
  is illegal when the straight `lineCoverageCubes` lane to it covers one of them.
  You cannot loft through a man on top of you; non-adjacent opponents, teammates
  and obstacles never block.
- **two-step aim** — pick the receiver (a teammate that can still be reached —
  one with a hex it can run to in the zone), then a landing hex in the zone *and*
  one the receiver can **run to** in 3 steps (`reachableCubes`, other players
  blocking the run). A teammate whose whole run stays inside an opponent's shadow
  is not selectable.
- **reactions** — once the landing hex is locked: the receiver moves up to 3, one
  opponent moves up to 3, and — only when the ball lands in `penaltyArea` — the
  defending keeper moves 1, or 4 when it is within 5 hexes of the landing hex
  (its own move, not stacked with the outfield opponent's).
- **accuracy** — the passer rolls `d6`; `roll + highPass >= highPassAccuracyOn ??
  8` lands it on the spot. A miss scatters with `looseBall` from the target hex
  (direction + distance only — nobody catches it mid-air).
- **header** — everyone within two hexes of where it comes down contests
  `d6 + heading` (`aerial` for a keeper); two hexes out is `-1`. Highest score
  wins (`headed`); a tie, or nobody near, spills it (`loose`). The headed pass /
  shot that follows a win is a later session.

Implemented as `high-pass` — direct fns + an event reducer, a sibling to
`pass-action`. `Piece` gained `role` + the `heading` / `aerial` / `highPass`
attrs; `MoveActionState` gained `highPassRange` / `highPassAccuracyOn` /
`penaltyArea` (an explicit hex list until the pitch builder lands). See
`docs/high-pass.md`.

## Deferred

Relative field tags decision · full challenge catalogue · set-piece rules
(throw-in, corner, goal kick, penalty — including the free kick / penalty a foul
leads to) · advantage / play-on · turn model (refreshing `movePoints` from pace,
re-applying the injury `-2`) · offside · the rules layer itself.
