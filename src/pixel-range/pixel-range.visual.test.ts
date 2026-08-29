import { describe, it } from "vitest";
import { cube, type Cube } from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";
import { pixelRangeCubes } from "./pixel-range.js";
import type { Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";

const origin = cube(0, 0, 0);

/** The hex-distance ring at exactly `radius` steps from `center`. */
function hexRing(center: Cube, radius: number): Cube[] {
  const hexes: Cube[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const hex = { x: center.x + dx, y: center.y + dy, z: center.z - dx - dy };
      if (cubeDistance(center, hex) === radius) hexes.push(hex);
    }
  }
  return hexes;
}

describe("pixel-range · circle query", () => {
  const draw = (name: string, title: string, range: number, radius: number) => {
    const s: Scenario = {
      radius,
      title,
      player: [origin],
      reachable: pixelRangeCubes(origin, range),
    };
    writeScenario("pixel-range", name, s);
  };

  it("range 2 — barely distinguishable from a hex disc", () => {
    draw("r2", "pixel range 2", 2, 4);
  });

  it("range 4 — a slightly rounded hexagon", () => {
    draw("r4", "pixel range 4", 4, 6);
  });

  it("range 8 — clearly circular", () => {
    draw("r8", "pixel range 8", 8, 10);
  });

  it("range 8 against the hex-distance ring at 8 (obstacle colour = contrast only)", () => {
    writeScenario("pixel-range", "r8-vs-hex", {
      radius: 10,
      title: "pixel range 8 vs hex ring 8 (grey)",
      player: [origin],
      obstacle: hexRing(origin, 8),
      reachable: pixelRangeCubes(origin, 8),
    });
  });

  it("off-centre", () => {
    const center = cube(3, -1);
    writeScenario("pixel-range", "offset", {
      radius: 8,
      title: "pixel range 4 around (3,-1,-2)",
      player: [center],
      reachable: pixelRangeCubes(center, 4),
    });
  });
});
