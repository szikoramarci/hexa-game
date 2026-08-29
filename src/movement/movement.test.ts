import { describe, expect, it } from "vitest";
import { cube, cubeKey } from "./coordinates.js";
import { reachableCubes } from "./movement.js";

const keys = (cs: ReturnType<typeof reachableCubes>) => new Set(cs.map(cubeKey));

describe("reachableCubes", () => {
  it("returns only the origin for zero steps", () => {
    expect(reachableCubes(cube(0, 0, 0), 0)).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it("returns the origin plus its six neighbours for one step", () => {
    const result = reachableCubes(cube(0, 0), 1);
    expect(result).toHaveLength(7);
    expect(keys(result)).toEqual(
      new Set([
        "0,0,0",
        "1,-1,0",
        "1,0,-1",
        "0,1,-1",
        "-1,1,0",
        "-1,0,1",
        "0,-1,1",
      ]),
    );
  });

  it("covers 1 + 3n(n+1) hexes on an open grid", () => {
    expect(reachableCubes(cube(0, 0), 2)).toHaveLength(19);
    expect(reachableCubes(cube(0, 0), 3)).toHaveLength(37);
  });

  it("is ordered by increasing distance from the origin", () => {
    const result = reachableCubes(cube(0, 0), 2);
    const dist = (c: { x: number; y: number; z: number }) =>
      (Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)) / 2;
    const distances = result.map(dist);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("does not step onto or through obstacles", () => {
    // Wall the origin in on every side: nothing but the origin is reachable.
    const wall = [
      cube(1, -1, 0),
      cube(1, 0, -1),
      cube(0, 1, -1),
      cube(-1, 1, 0),
      cube(-1, 0, 1),
      cube(0, -1, 1),
    ];
    expect(reachableCubes(cube(0, 0, 0), 5, wall)).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it("routes around a partial obstacle instead of through it", () => {
    const result = reachableCubes(cube(0, 0), 2, [cube(1, -1, 0)]);
    const k = keys(result);
    expect(k.has("1,-1,0")).toBe(false);
    // (2,-2,0) sits directly behind the blocked hex: only reachable by detour,
    // which costs 3 steps, so it stays out of a 2-step range.
    expect(k.has("2,-2,0")).toBe(false);
    // (2,-1,-1) is behind the block but reachable via (1,0,-1) in 2 steps.
    expect(k.has("2,-1,-1")).toBe(true);
  });

  it("accepts obstacles as a Set", () => {
    const obstacles = new Set([cube(1, -1, 0)]);
    expect(keys(reachableCubes(cube(0, 0), 1, obstacles)).has("1,-1,0")).toBe(false);
  });

  it("still includes the origin when the origin is an obstacle", () => {
    const result = reachableCubes(cube(0, 0, 0), 1, [cube(0, 0)]);
    expect(result[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(result).toHaveLength(7);
  });

  it("works away from the grid centre", () => {
    expect(reachableCubes(cube(5, -2), 1)).toHaveLength(7);
  });

  it("rejects a negative or non-integer step count", () => {
    expect(() => reachableCubes(cube(0, 0), -1)).toThrow(RangeError);
    expect(() => reachableCubes(cube(0, 0), 1.5)).toThrow(RangeError);
  });
});
