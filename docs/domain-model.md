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
- `resilience` = injury resistance. Injury system deferred.

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
plus the defender lunge, in `move-action`. See `docs/tackle-action.md`. A foul
is still a `TODO` dead end; a tie now scatters the ball (below).

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

## Deferred

Injury system · relative field tags decision · full challenge catalogue ·
set-piece rules (throw-in, corner, goal kick, penalty) · offside · the rules
layer itself.
