import { describe, it } from "vitest";
import { cube, type Cube } from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";
import { lineCoverageCubes } from "./line-coverage.js";
import type { Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";

describe("line-coverage · supercover line", () => {
  const draw = (name: string, title: string, start: Cube, end: Cube, radius?: number) => {
    const s: Scenario = {
      radius: radius ?? Math.ceil(cubeDistance(start, end)) + 1,
      title,
      player: [start],
      goal: [end],
      reachable: lineCoverageCubes(start, end),
      // The raw centre-to-centre segment the supercover is derived from.
      lines: [[start, end]],
    };
    writeScenario("line-coverage", name, s);
  };

  it("adjacent — the two-hex minimum", () => {
    draw("adjacent", "line coverage — adjacent hexes", cube(0, 0, 0), cube(1, 0, -1), 2);
  });

  it("axis — a clean collinear run", () => {
    draw("axis", "line coverage — collinear centres", cube(-3, 0, 3), cube(3, 0, -3));
  });

  it("along-edge — doubled hexes flanking a shared edge", () => {
    draw("along-edge", "line coverage — runs along a shared edge", cube(0, 0, 0), cube(4, -2, -2));
  });

  it("steep — a general diagonal", () => {
    draw("steep", "line coverage — steep diagonal", cube(0, 4, -4), cube(3, -5, 2));
  });

  it("shallow — a general diagonal at a gentler slope", () => {
    draw("shallow", "line coverage — shallow diagonal", cube(-5, 2, 3), cube(6, -1, -5));
  });

  it("offset — non-origin endpoints", () => {
    draw("offset", "line coverage — off-centre", cube(-1, -2, 3), cube(4, -3, -1), 6);
  });
});
