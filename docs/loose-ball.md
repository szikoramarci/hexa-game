# Session spec: loose ball (scatter a drawn challenge)

Goal: resolve the **tie** dead end left by the tackle. A drawn challenge spills
the ball: `d6` direction, `d6` distance, roll it in a straight line, the first
player on the line catches it. Pure logic, its own folder, wired into the
`looseBall` phase of `move-action`.

## Placement

New utility `src/loose-ball/loose-ball.ts` + `loose-ball.test.ts` +
`loose-ball.visual.test.ts`. `move-action.ts` imports it (one direction — no
cycle) and calls it from `resolveTackle` on a tie. `docs/domain-model.md`
"Loose ball scatter" is the rules source.

## Rules

| step | rule |
| --- | --- |
| direction | `d6` → `CUBE_DIRECTIONS[roll - 1]` (the six hex directions) |
| distance | `d6` → hexes the ball rolls if nothing stops it |
| route | `origin`, then one hex per step along `direction`, up to `distance` |
| catch | the **first** stopper standing on `route[1..]` stops the ball and owns it; `origin` itself is never a stopping hex (the ball rolls away from it) |
| rest | the catch hex, or the full-distance hex if the line is clear |

Field edges, goals and obstacles are **out of scope** — the ball may roll off
the board here. The rules layer reads `rest`'s hex tags later (goal / throw-in).

## API

```ts
export interface BallStopper { id: string; at: Cube; }

export interface LooseBallRoll {
  directionRoll: number;          // raw d6, 1..6
  distanceRoll: number;           // raw d6, 1..die
  direction: Cube;                // the unit step
  route: Cube[];                  // origin first … rest last
  rest: Cube;                     // route[route.length - 1]
  caughtBy: string | null;        // stopper id, or null if it rolled clear
  rng: Rng;                       // after two draws — direction then distance
}

export function looseBall(
  rng: Rng,
  origin: Cube,
  stoppers: readonly BallStopper[],
  die?: number,                   // distance die, default 6
): LooseBallRoll;
```

Pure, deterministic, never mutates inputs. `rng` advances by exactly two draws
(direction first).

## move-action wiring

`resolveTackle`, tie branch — was: phase `looseBall`, ball unchanged (TODO).
Now:

1. `looseBall(roll.rng, outcome.at, moved.pieces, stealDie)` — every piece is a
   stopper; the just-tackled carrier sits on `origin` so it cannot re-catch.
2. `state.ball = scatter.rest`. A `caughtBy` piece already stands there, so
   `ballCarrier` returns it; otherwise the ball is loose.
3. Phase stays `looseBall` (terminal — defender's points are spent). Snapshot
   carries `scatter`; `selectPiece` / `cancel` leave it, as before.

Snapshot gains `scatter: LooseBallRoll | null`. View gains
`scatter: (LooseBallRoll & { at: Cube }) | null` (set in `looseBall` only); the
`looseBall` marker stays. `winner` is still `null`, so `relocationOptions` /
`applyTackle` remain no-ops.

Drop the `TODO(loose-ball)` comment; replace with a pointer to this spec. Foul
is still a TODO dead end.

## Tests — `loose-ball.test.ts`

1. fixed seed → known `directionRoll` / `distanceRoll`; `direction` is the
   matching `CUBE_DIRECTIONS` entry; `rng` advanced by two `rollDie` draws.
2. clear line → `route` has `distanceRoll + 1` hexes, `rest` the last,
   `caughtBy` null.
3. a stopper two hexes along the roll → ball stops on it, `route` ends there,
   `caughtBy` its id, even when `distanceRoll` is larger.
4. a stopper on `origin` is ignored (ball still rolls).
5. two stoppers on the line → the nearer one catches it.
6. a stopper off the rolled line → no catch.
7. determinism: same seed → identical `LooseBallRoll`.

## Tests — `move-action.test.ts` (rewrite the tie case)

- a tie scatters: `phase` `looseBall`, `state.ball === moveView(s).scatter.rest`,
  `scatter` on the snapshot, `rng` advanced past the two scatter draws.
- clear-line tie → ball loose on `rest`, `ballCarrier` null.
- a defender resting on the scatter line catches it → `ballCarrier` is the
  defender, ball on its hex.
- replay: a fixed tie seed reproduces the scatter (`route`, `rest`, `caughtBy`).
- `selectPiece` / `cancel` still leave the `looseBall` phase.

## Visual — static SVGs (`loose-ball.visual.test.ts`)

`writeScenario("loose-ball", …)` — feed real `looseBall` output into
`path` (the route) + `goal` (rest) + `player` (stoppers) + an `arrows` entry
for the direction:

| case | shows |
| --- | --- |
| `clear-roll` | origin → 4 clear hexes, ball rests at the end |
| `caught` | a stopper mid-line stops a longer roll |
| `six-directions` | one board, the six direction outcomes fanned from the origin |

## Playground — `actions/movement`

The inline mirror learns `looseBall`. A tackle tie now:

- rolls the scatter, logs it under the board — `loose ball — scores level ·
  d6 … vs d6 … · scatter d6 dir N, d6 dist M → {Label collects it | rolls K
  hexes clear}`;
- draws the scatter route (slate arrow) and rolls the ball hex-by-hex along it;
- glows the catcher, or leaves the ball sitting on `rest`.

One new case (`Loose ball in a crowd` — carrier + adjacent defender, equal
attrs, other players scattered 1–2 hexes out so a scatter often finds someone).
`reset` re-rolls. The playground test cross-checks the baked-seed scatter
against the real `looseBall`.

## Done when

- [x] `npm run typecheck && npm test` pass.
- [x] `looseBall`, `BallStopper`, `LooseBallRoll` re-exported from `src/index.ts`.
- [x] `move-action` tie scatters; `TODO(loose-ball)` gone; foul still TODO.
- [x] `docs/domain-model.md` + README cross-link this spec; scenarios render.
