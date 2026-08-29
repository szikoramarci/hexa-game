import { describe, expect, it } from "vitest";
import {
  CUBE_DIRECTIONS,
  cube,
  cubeAdd,
  cubeEquals,
  cubeKey,
  cubeScale,
  cubeSubtract,
  isCube,
} from "./coordinates.js";

describe("cube", () => {
  it("derives z when omitted", () => {
    expect(cube(2, -3)).toEqual({ x: 2, y: -3, z: 1 });
  });

  it("accepts a valid explicit triple", () => {
    expect(cube(0, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("rejects a triple that does not sum to zero", () => {
    expect(() => cube(1, 1, 1)).toThrow(RangeError);
  });
});

describe("isCube", () => {
  it("accepts a valid cube", () => {
    expect(isCube({ x: 1, y: -1, z: 0 })).toBe(true);
  });

  it("rejects non-objects and malformed values", () => {
    expect(isCube(null)).toBe(false);
    expect(isCube({ x: 1, y: 2 })).toBe(false);
    expect(isCube({ x: 1, y: 1, z: 1 })).toBe(false);
  });
});

describe("vector math", () => {
  const a = cube(1, -1, 0);
  const b = cube(0, 1, -1);

  it("adds", () => {
    expect(cubeAdd(a, b)).toEqual({ x: 1, y: 0, z: -1 });
  });

  it("subtracts", () => {
    expect(cubeSubtract(a, b)).toEqual({ x: 1, y: -2, z: 1 });
  });

  it("scales", () => {
    expect(cubeScale(a, 3)).toEqual({ x: 3, y: -3, z: 0 });
  });
});

describe("cubeEquals / cubeKey", () => {
  it("compares by value", () => {
    expect(cubeEquals(cube(1, -1, 0), cube(1, -1, 0))).toBe(true);
    expect(cubeEquals(cube(1, -1, 0), cube(0, 0, 0))).toBe(false);
  });

  it("produces a stable key", () => {
    expect(cubeKey(cube(1, -1, 0))).toBe("1,-1,0");
  });
});

describe("CUBE_DIRECTIONS", () => {
  it("has six unit vectors that each satisfy x + y + z = 0", () => {
    expect(CUBE_DIRECTIONS).toHaveLength(6);
    for (const d of CUBE_DIRECTIONS) {
      expect(d.x + d.y + d.z).toBe(0);
      expect(Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z)).toBe(2);
    }
  });
});
