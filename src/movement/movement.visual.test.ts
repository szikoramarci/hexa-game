import { describe, expect, it } from "vitest";
import { cube } from "../coordinates/coordinates.js";
import { reachableCubes } from "./movement.js";
import type { Cube } from "../coordinates/coordinates.js";
import type { Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";

const origin = cube(0, 0, 0);

/** Straight line of `count` hexes from `from`, stepping by `dir`. */
function wall(from: Cube, dir: Cube, count: number): Cube[] {
  const hexes: Cube[] = [];
  for (let i = 0; i < count; i++) {
    hexes.push(cube(from.x + dir.x * i, from.y + dir.y * i, from.z + dir.z * i));
  }
  return hexes;
}

const SE = cube(0, 1, -1); // south-east step
const N = cube(0, -1, 1); // north step

describe("movement · reachable — no obstacles", () => {
  for (const steps of [0, 2, 5]) {
    it(`${steps} steps`, () => {
      const reachable = reachableCubes(origin, steps);
      expect(reachable).toHaveLength(1 + 3 * steps * (steps + 1));
      const s: Scenario = {
        radius: Math.max(steps + 1, 2),
        title: `reachable — ${steps} steps, open`,
        player: [origin],
        reachable,
      };
      writeScenario("movement", `open-${steps}`, s);
    });
  }
});

describe("movement · reachable — with obstacles, 4 steps", () => {
  const draw = (name: string, title: string, obstacle: Cube[]) => {
    const s: Scenario = {
      radius: 5,
      title: `${title} — 4 steps`,
      player: [origin],
      obstacle,
      reachable: reachableCubes(origin, 4, obstacle),
    };
    writeScenario("movement", name, s);
  };

  it("one obstacle next to the player", () => {
    draw("obs-adjacent", "one obstacle beside player", [cube(1, -1, 0)]);
  });

  it("one obstacle beside the player's next hex", () => {
    // Two hexes east: adjacent to the hex the player would step to first.
    draw("obs-second-ring", "one obstacle two hexes out", [cube(2, -2, 0)]);
  });

  it("multiple obstacles, scattered", () => {
    draw("obs-scattered", "scattered obstacles", [
      cube(2, -1, -1),
      cube(-1, 2, -1),
      cube(-2, 0, 2),
      cube(1, 1, -2),
      cube(0, -2, 2),
    ]);
  });

  it("multiple obstacles forming one wall", () => {
    // Vertical wall two hexes east of the player.
    draw("obs-wall", "one wall", wall(cube(2, -3, 1), SE, 5));
  });

  it("multiple walls", () => {
    draw("obs-walls", "two walls", [
      ...wall(cube(2, -3, 1), SE, 4), // east wall
      ...wall(cube(-2, 3, -1), N, 4), // west wall
    ]);
  });

  it("player walled in on every side", () => {
    const ring = [
      cube(1, -1, 0),
      cube(1, 0, -1),
      cube(0, 1, -1),
      cube(-1, 1, 0),
      cube(-1, 0, 1),
      cube(0, -1, 1),
    ];
    const reachable = reachableCubes(origin, 4, ring);
    expect(reachable).toHaveLength(1);
    writeScenario("movement", "walled-in", {
      radius: 5,
      title: "walled in — 4 steps",
      player: [origin],
      obstacle: ring,
      reachable,
    });
  });

  it("walled in except for one gap", () => {
    // Full ring minus the eastern neighbour: the flood escapes through it.
    const ring = [
      cube(1, 0, -1),
      cube(0, 1, -1),
      cube(-1, 1, 0),
      cube(-1, 0, 1),
      cube(0, -1, 1),
    ];
    draw("wall-gap", "walled in but one gap", ring);
  });
});
