import { describe, it } from "vitest";
import { cube, type Cube } from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";
import { pathCubes } from "./pathfind.js";
import type { Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";

/** A straight line of `count` hexes from `origin`, stepping by `dir`. */
function wall(origin: Cube, dir: Cube, count: number): Cube[] {
  return Array.from({ length: count }, (_, i) =>
    cube(origin.x + dir.x * i, origin.y + dir.y * i, origin.z + dir.z * i),
  );
}

const SE = cube(0, 1, -1);
const NE = cube(1, 0, -1);
const S = cube(-1, 1, 0);

describe("pathfind · A* around obstacles", () => {
  const draw = (
    name: string,
    title: string,
    start: Cube,
    end: Cube,
    obstacle: Cube[],
    radius?: number,
  ) => {
    const s: Scenario = {
      radius: radius ?? Math.ceil(cubeDistance(start, end)) + 2,
      title,
      player: [start],
      goal: [end],
      obstacle,
      path: pathCubes(start, end, obstacle) ?? [],
      // The straight centre-to-centre reference chord.
      lines: [[start, end]],
    };
    writeScenario("pathfind", name, s);
  };

  it("open — no obstacles, a clean diagonal", () => {
    draw("open", "pathfind — open grid", cube(-4, 2, 2), cube(4, -1, -3), []);
  });

  it("around-wall — a short detour past one wall", () => {
    draw(
      "around-wall",
      "pathfind — around a wall",
      cube(-4, 1, 3),
      cube(4, -1, -3),
      wall(cube(0, -3, 3), SE, 6),
    );
  });

  it("two-gaps — the shorter opening wins", () => {
    const full = wall(cube(1, -6, 5), SE, 11);
    const gap = cube(1, -1, 0); // roughly level with the endpoints
    draw(
      "two-gaps",
      "pathfind — two gaps, shorter wins",
      cube(-3, 0, 3),
      cube(5, -3, -2),
      full.filter((h) => !(h.x === gap.x && h.y === gap.y && h.z === gap.z)),
      7,
    );
  });

  it("corridor — threading an S-shaped passage", () => {
    const obstacle = [
      ...wall(cube(-4, 0, 4), NE, 6), // upper bar
      ...wall(cube(2, -1, -1), S, 5), // right elbow going down
      ...wall(cube(-3, 3, 0), NE, 6), // lower bar
    ];
    draw("corridor", "pathfind — S-corridor", cube(-4, 2, 2), cube(3, 1, -4), obstacle, 7);
  });

  it("maze — a dense scatter", () => {
    const obstacle = [
      cube(-2, 0, 2), cube(-2, 1, 1), cube(-1, -1, 2), cube(-1, 2, -1),
      cube(0, -2, 2), cube(0, 1, -1), cube(1, -1, 0), cube(1, 1, -2),
      cube(2, -2, 0), cube(2, 0, -2), cube(2, 1, -3), cube(3, -1, -2),
    ];
    draw("maze", "pathfind — dense scatter", cube(-4, 2, 2), cube(4, -2, -2), obstacle, 6);
  });

  it("enclosed — goal boxed in, no path", () => {
    const end = cube(3, -3, 0);
    const ring = [
      cube(4, -4, 0), cube(4, -3, -1), cube(3, -2, -1),
      cube(2, -2, 0), cube(2, -3, 1), cube(3, -4, 1),
    ];
    draw("enclosed", "pathfind — goal enclosed (no path)", cube(-3, 3, 0), end, ring, 6);
  });

  it("offset — endpoints and wall away from the origin", () => {
    draw(
      "offset",
      "pathfind — off-centre",
      cube(-6, 2, 4),
      cube(-1, 3, -2),
      wall(cube(-4, 0, 4), SE, 6),
      8,
    );
  });
});
