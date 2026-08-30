import { describe, it } from "vitest";
import { cube, cubeAdd, cubeScale, type Cube } from "../coordinates/coordinates.js";
import { rollDie, seedRng } from "../dice/dice.js";
import type { ArrowSpec, Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";
import { looseBall, type BallStopper } from "./loose-ball.js";

const origin = cube(0, 0, 0);
const draw = (name: string, s: Scenario) => writeScenario("loose-ball", name, s);

/** First seed whose (d6 direction, d6 distance) pair satisfies `pred`. */
function seedFor(pred: (dir: number, dist: number) => boolean): number {
  for (let s = 1; s < 200_000; s++) {
    const [dir, r1] = rollDie(seedRng(s), 6);
    const [dist] = rollDie(r1, 6);
    if (pred(dir, dist)) return s;
  }
  throw new Error("no seed matches");
}

describe("loose-ball · scatter", () => {
  it("clear roll — the ball runs the full distance", () => {
    const roll = looseBall(seedRng(seedFor((_d, dist) => dist === 4)), origin, []);
    const arrows: ArrowSpec[] = [
      { hexes: roll.route, shape: "straight", weight: "thick", color: "#6a5acd" },
    ];
    draw("clear-roll", {
      radius: 6,
      title: `clear roll — d6 dir ${roll.directionRoll}, d6 dist ${roll.distanceRoll}`,
      player: [origin],
      goal: [roll.rest],
      path: roll.route,
      arrows,
    });
  });

  it("caught — a player on the line stops a longer roll", () => {
    const seed = seedFor((_d, dist) => dist >= 5);
    const dir = looseBall(seedRng(seed), origin, []).direction;
    const keeper: BallStopper = { id: "K", at: cubeAdd(origin, cubeScale(dir, 2)) };
    const roll = looseBall(seedRng(seed), origin, [keeper]);
    const arrows: ArrowSpec[] = [
      { hexes: roll.route, shape: "straight", weight: "thick", color: "#6a5acd" },
    ];
    draw("caught", {
      radius: 6,
      title: `caught — would roll ${roll.distanceRoll}, K stops it at 2`,
      player: [keeper.at],
      goal: [roll.rest],
      path: roll.route,
      arrows,
    });
  });

  it("six directions — the scatter fan from one origin", () => {
    const seen = new Map<number, ArrowSpec>();
    for (let s = 1; seen.size < 6 && s < 200_000; s++) {
      const roll = looseBall(seedRng(s), origin, []);
      if (roll.distanceRoll < 3 || seen.has(roll.directionRoll)) continue;
      const line: Cube[] = [origin, cubeAdd(origin, cubeScale(roll.direction, 3))];
      seen.set(roll.directionRoll, {
        hexes: line,
        shape: "straight",
        color: "#6a5acd",
      });
    }
    draw("six-directions", {
      radius: 5,
      title: "scatter fan — a d6 picks one of the six directions",
      player: [origin],
      arrows: [...seen.values()],
    });
  });
});
