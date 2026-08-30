import { describe, expect, it } from "vitest";
import {
  CUBE_DIRECTIONS,
  cube,
  cubeAdd,
  cubeEquals,
  cubeKey,
  cubeScale,
  type Cube,
} from "../coordinates/coordinates.js";
import { rollDie, seedRng } from "../dice/dice.js";
import { looseBall, type BallStopper } from "./loose-ball.js";

const origin = cube(0, 0, 0);
const keys = (hexes: Iterable<Cube>) => [...hexes].map(cubeKey);

/** First seed whose (d6 direction, d<die> distance) pair satisfies `pred`. */
function seedFor(
  pred: (dir: number, dist: number) => boolean,
  die = 6,
): number {
  for (let s = 1; s < 200_000; s++) {
    const [dir, r1] = rollDie(seedRng(s), 6);
    const [dist] = rollDie(r1, die);
    if (pred(dir, dist)) return s;
  }
  throw new Error("no seed matches");
}

describe("looseBall", () => {
  it("rolls a d6 direction then a d6 distance, advancing rng by two draws", () => {
    const rng = seedRng("scatter");
    const [dir, r1] = rollDie(rng, 6);
    const [dist, r2] = rollDie(r1, 6);

    const roll = looseBall(rng, origin, []);
    expect(roll.directionRoll).toBe(dir);
    expect(roll.distanceRoll).toBe(dist);
    expect(roll.direction).toEqual(CUBE_DIRECTIONS[dir - 1]);
    expect(roll.rng).toBe(r2);
  });

  it("rolls the full distance down a clear line", () => {
    const seed = seedFor((_d, dist) => dist === 4);
    const roll = looseBall(seedRng(seed), origin, []);

    expect(roll.route).toHaveLength(5); // origin + 4
    expect(roll.route[0]).toEqual(origin);
    expect(roll.caughtBy).toBeNull();
    expect(roll.rest).toEqual(cubeAdd(origin, cubeScale(roll.direction, 4)));
    expect(roll.route[4]).toEqual(roll.rest);
  });

  it("stops on the first stopper on the line, even with distance to spare", () => {
    const seed = seedFor((_d, dist) => dist >= 4);
    const dir = CUBE_DIRECTIONS[rollDie(seedRng(seed), 6)[0] - 1]!;
    const twoAlong = cubeAdd(origin, cubeScale(dir, 2));
    const stoppers: BallStopper[] = [{ id: "keeper", at: twoAlong }];

    const roll = looseBall(seedRng(seed), origin, stoppers);
    expect(roll.caughtBy).toBe("keeper");
    expect(roll.rest).toEqual(twoAlong);
    expect(roll.route).toHaveLength(3); // origin, one hex, the stopper
  });

  it("ignores a stopper standing on the origin", () => {
    const seed = seedFor((_d, dist) => dist === 3);
    const roll = looseBall(seedRng(seed), origin, [{ id: "tackled", at: origin }]);
    expect(roll.caughtBy).toBeNull();
    expect(roll.route).toHaveLength(4);
  });

  it("the nearer of two stoppers on the line catches it", () => {
    const seed = seedFor((_d, dist) => dist >= 3);
    const dir = CUBE_DIRECTIONS[rollDie(seedRng(seed), 6)[0] - 1]!;
    const stoppers: BallStopper[] = [
      { id: "far", at: cubeAdd(origin, cubeScale(dir, 3)) },
      { id: "near", at: cubeAdd(origin, cubeScale(dir, 1)) },
    ];
    expect(looseBall(seedRng(seed), origin, stoppers).caughtBy).toBe("near");
  });

  it("a stopper off the rolled line does not catch it", () => {
    const seed = seedFor((_d, dist) => dist === 3);
    const dir = CUBE_DIRECTIONS[rollDie(seedRng(seed), 6)[0] - 1]!;
    const sideways = CUBE_DIRECTIONS[(rollDie(seedRng(seed), 6)[0] + 1) % 6]!;
    const offLine = cubeAdd(cubeAdd(origin, cubeScale(dir, 2)), sideways);

    const roll = looseBall(seedRng(seed), origin, [{ id: "bystander", at: offLine }]);
    expect(roll.caughtBy).toBeNull();
    expect(roll.route).toHaveLength(4);
  });

  it("replays identically from the same seed", () => {
    const stoppers: BallStopper[] = [{ id: "d", at: cube(2, -2, 0) }];
    const a = looseBall(seedRng("match-7"), origin, stoppers);
    const b = looseBall(seedRng("match-7"), origin, stoppers);
    expect(a).toEqual(b);
  });

  it("never mutates its inputs", () => {
    const frozenOrigin = Object.freeze(cube(1, -1, 0));
    const stoppers = Object.freeze([
      Object.freeze({ id: "d", at: Object.freeze(cube(3, -3, 0)) }),
    ]) as readonly BallStopper[];
    expect(() => looseBall(seedRng(3), frozenOrigin, stoppers)).not.toThrow();
  });

  it("keeps every direction reachable across many seeds", () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 600; s++) {
      seen.add(keys([looseBall(seedRng(s), origin, []).direction])[0]!);
    }
    for (const d of CUBE_DIRECTIONS) expect(seen.has(cubeKey(d))).toBe(true);
  });

  it("route steps are all one hex apart along the direction", () => {
    const roll = looseBall(seedRng("walk"), origin, []);
    for (let i = 1; i < roll.route.length; i++) {
      expect(cubeEquals(
        roll.route[i]!,
        cubeAdd(roll.route[i - 1]!, roll.direction),
      )).toBe(true);
    }
  });
});
