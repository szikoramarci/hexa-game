import { describe, expect, it } from "vitest";
import {
  CUBE_DIRECTIONS,
  cube,
  cubeAdd,
  cubeEquals,
  cubeKey,
  type Cube,
} from "../coordinates/coordinates.js";
import { pathCubes } from "./pathfind.js";

const keys = (cs: Cube[]) => cs.map(cubeKey);
const dist = (a: Cube, b: Cube) =>
  (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2;

/** Assert a result is a contiguous, obstacle-free walk from `start` to `end`. */
function expectValidPath(
  path: Cube[] | null,
  start: Cube,
  end: Cube,
  obstacles: Cube[] = [],
): asserts path is Cube[] {
  expect(path).not.toBeNull();
  const p = path!;
  expect(p[0]).toEqual({ x: start.x, y: start.y, z: start.z });
  expect(p.at(-1)).toEqual({ x: end.x, y: end.y, z: end.z });
  const blocked = new Set(obstacles.map(cubeKey));
  blocked.delete(cubeKey(start));
  blocked.delete(cubeKey(end));
  for (let i = 0; i < p.length; i++) {
    expect(blocked.has(cubeKey(p[i]!))).toBe(false);
    if (i > 0) expect(dist(p[i - 1]!, p[i]!)).toBe(1);
  }
}

/** A straight line of `count` hexes from `origin`, stepping by `dir`. */
function wall(origin: Cube, dir: Cube, count: number): Cube[] {
  return Array.from({ length: count }, (_, i) =>
    cube(origin.x + dir.x * i, origin.y + dir.y * i, origin.z + dir.z * i),
  );
}

const origin = cube(0, 0, 0);
const SE = cube(0, 1, -1); // south-east step

describe("pathCubes", () => {
  it("returns just the start when start equals end", () => {
    expect(pathCubes(origin, cube(0, 0, 0))).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it("returns just the start even when that hex is an obstacle", () => {
    expect(pathCubes(origin, cube(0, 0, 0), [cube(0, 0, 0)])).toEqual([
      { x: 0, y: 0, z: 0 },
    ]);
  });

  it("returns exactly the two hexes for an adjacent pair, start first", () => {
    expect(pathCubes(origin, cube(1, -1, 0))).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: -1, z: 0 },
    ]);
  });

  it("walks straight along an axis on an open grid", () => {
    const end = cube(4, -4, 0);
    expect(pathCubes(origin, end)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: 2, y: -2, z: 0 },
      { x: 3, y: -3, z: 0 },
      { x: 4, y: -4, z: 0 },
    ]);
  });

  it("finds a shortest diagonal path on an open grid", () => {
    const start = cube(-3, 1, 2);
    const end = cube(4, -2, -2);
    const path = pathCubes(start, end);
    expectValidPath(path, start, end);
    expect(path).toHaveLength(dist(start, end) + 1);
  });

  it("routes around a wall that blocks the direct line", () => {
    // Vertical wall two hexes east, long enough to force a detour.
    const obstacles = wall(cube(2, -5, 3), SE, 7);
    const start = origin;
    const end = cube(4, -2, -2);
    const path = pathCubes(start, end, obstacles);
    expectValidPath(path, start, end, obstacles);
    expect(path.length).toBeGreaterThan(dist(start, end) + 1);
  });

  it("returns null when the start is ringed by obstacles", () => {
    const ring = CUBE_DIRECTIONS.map((d) => cubeAdd(origin, d));
    expect(pathCubes(origin, cube(5, -5, 0), ring)).toBeNull();
  });

  it("returns null when the end is ringed by obstacles", () => {
    const end = cube(5, -5, 0);
    const ring = CUBE_DIRECTIONS.map((d) => cubeAdd(end, d));
    expect(pathCubes(origin, end, ring)).toBeNull();
  });

  it("still solves when only the start or the end sits on an obstacle", () => {
    const start = origin;
    const end = cube(3, -3, 0);
    const path = pathCubes(start, end, [start, end, cube(1, -1, 0)]);
    // The blocking hex on the direct line still forces a step aside.
    expectValidPath(path, start, end, [cube(1, -1, 0)]);
  });

  it("takes the shorter of two gaps in a wall", () => {
    // Wall along the SE axis at x = 3, with gaps near the top and far bottom.
    const full = wall(cube(3, -8, 5), SE, 12);
    const nearGap = cube(3, -1, -2);
    const farGap = cube(3, -7, 4);
    const obstacles = full.filter(
      (h) => !(cubeEquals(h, nearGap) || cubeEquals(h, farGap)),
    );
    const start = cube(0, 0, 0);
    const end = cube(6, -2, -4);
    const path = pathCubes(start, end, obstacles);
    expectValidPath(path, start, end, obstacles);
    // The near gap is roughly level with both endpoints; the path should use it.
    expect(path.some((h) => cubeEquals(h, nearGap))).toBe(true);
    expect(path.some((h) => cubeEquals(h, farGap))).toBe(false);
  });

  it("is symmetric in path length when the endpoints are swapped", () => {
    const a = cube(-2, 4, -2);
    const b = cube(5, -3, -2);
    const obstacles = wall(cube(1, 0, -1), SE, 4);
    const there = pathCubes(a, b, obstacles);
    const back = pathCubes(b, a, obstacles);
    expect(there).not.toBeNull();
    expect(back).not.toBeNull();
    expect(back!.length).toBe(there!.length);
    expect(keys([...back!].reverse())[0]).toBe(keys(there!)[0]);
  });

  it("is deterministic for identical inputs", () => {
    const start = cube(0, 0, 0);
    const end = cube(5, -2, -3);
    const obstacles = [cube(2, -1, -1), cube(2, 0, -2), cube(3, -2, -1)];
    const a = pathCubes(start, end, obstacles);
    const b = pathCubes(start, end, obstacles);
    expect(a).toEqual(b);
  });

  it("does not mutate its inputs", () => {
    const start = cube(0, 0, 0);
    const end = cube(3, -1, -2);
    const obstacles = [cube(1, 0, -1)];
    const frozenStart = Object.freeze({ ...start });
    pathCubes(start, end, obstacles);
    expect(start).toEqual(frozenStart);
    expect(obstacles).toEqual([cube(1, 0, -1)]);
  });

  it("works away from the grid centre", () => {
    const start = cube(10, -4, -6);
    const end = cube(13, -5, -8);
    const path = pathCubes(start, end);
    expectValidPath(path, start, end);
    expect(path).toHaveLength(dist(start, end) + 1);
  });
});
