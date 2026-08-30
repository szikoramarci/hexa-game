import {
  CUBE_DIRECTIONS,
  cubeAdd,
  cubeKey,
  cubeScale,
  type Cube,
} from "../coordinates/coordinates.js";
import { rollDie, type Rng } from "../dice/dice.js";

/**
 * Loose-ball scatter. When a challenge draws — a tied tackle, later a missed
 * pass or a rebound — the ball spills: `d6` picks one of the six hex directions,
 * `d6` picks a distance, and the ball rolls that far in a straight line from its
 * origin. The **first** player standing on the line stops it and takes it;
 * otherwise it comes to rest at the full distance.
 *
 * `origin` is never a stopping hex — the ball is rolling away from it — so the
 * player who was just tackled (still on the ball's old hex) cannot re-catch it.
 *
 * Field edges and goals are out of scope: the ball may roll off the board here.
 * The rules layer reads the resting hex's tags later (goal, throw-in, …). See
 * `docs/loose-ball.md` and `docs/domain-model.md` "Loose ball scatter".
 */

/** A player the rolling ball can run into. */
export interface BallStopper {
  id: string;
  at: Cube;
}

/** Where a loose ball scattered to, and how the dice fell. */
export interface LooseBallRoll {
  /** Raw `d6`, `1..6` — indexes {@link CUBE_DIRECTIONS}. */
  directionRoll: number;
  /** Raw die roll, `1..die` — hexes the ball rolls if the line is clear. */
  distanceRoll: number;
  /** The unit step the ball rolls along — `CUBE_DIRECTIONS[directionRoll - 1]`. */
  direction: Cube;
  /**
   * The hexes the ball rolls over, `origin` first. It ends at {@link rest}: the
   * full `distanceRoll` hexes, or sooner if a stopper is in the way.
   */
  route: Cube[];
  /** The hex the ball comes to rest on — `route[route.length - 1]`. */
  rest: Cube;
  /** Id of the stopper that caught it on the way, or `null` if it rolled clear. */
  caughtBy: string | null;
  /** The `Rng` after both draws — direction first, then distance. */
  rng: Rng;
}

const copy = (c: Cube): Cube => ({ x: c.x, y: c.y, z: c.z });

/**
 * Scatter a loose ball from `origin`. Rolls a `d6` for the direction and a
 * `d<die>` (default 6) for the distance, then walks the straight line, stopping
 * on the first {@link BallStopper}. Pure; advances `rng` by exactly two draws.
 */
export function looseBall(
  rng: Rng,
  origin: Cube,
  stoppers: readonly BallStopper[],
  die = 6,
): LooseBallRoll {
  const [directionRoll, r1] = rollDie(rng, 6);
  const [distanceRoll, r2] = rollDie(r1, die);
  const direction = CUBE_DIRECTIONS[directionRoll - 1]!;

  const stopperAt = new Map(stoppers.map((s) => [cubeKey(s.at), s.id]));
  const route: Cube[] = [copy(origin)];
  let caughtBy: string | null = null;
  for (let step = 1; step <= distanceRoll; step++) {
    const hex = cubeAdd(origin, cubeScale(direction, step));
    route.push(hex);
    const hit = stopperAt.get(cubeKey(hex));
    if (hit != null) {
      caughtBy = hit;
      break;
    }
  }

  return {
    directionRoll,
    distanceRoll,
    direction: copy(direction),
    route,
    rest: copy(route[route.length - 1]!),
    caughtBy,
    rng: r2,
  };
}
