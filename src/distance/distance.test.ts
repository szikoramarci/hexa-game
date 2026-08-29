import { describe, expect, it } from "vitest";
import { CUBE_DIRECTIONS, cube, cubeAdd } from "../coordinates/coordinates.js";
import { cubeDistance } from "./distance.js";

const origin = cube(0, 0, 0);

describe("cubeDistance", () => {
  it("is zero between a hex and itself", () => {
    expect(cubeDistance(origin, cube(0, 0, 0))).toBe(0);
    expect(cubeDistance(cube(3, -1, -2), cube(3, -1, -2))).toBe(0);
  });

  it("is one between neighbours", () => {
    for (const d of CUBE_DIRECTIONS) {
      expect(cubeDistance(origin, cubeAdd(origin, d))).toBe(1);
    }
  });

  it("counts steps along an axis and a diagonal", () => {
    expect(cubeDistance(origin, cube(4, -4, 0))).toBe(4);
    expect(cubeDistance(origin, cube(3, -1, -2))).toBe(3);
    expect(cubeDistance(cube(-2, 0, 2), cube(1, -3, 2))).toBe(3);
  });

  it("is symmetric", () => {
    const a = cube(5, -2, -3);
    const b = cube(-1, 4, -3);
    expect(cubeDistance(a, b)).toBe(cubeDistance(b, a));
  });
});
