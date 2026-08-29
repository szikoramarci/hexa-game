import { describe, expect, it } from "vitest";
import { cube, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { lineCoverageCubes } from "./line-coverage.js";

const keys = (cs: Cube[]) => new Set(cs.map(cubeKey));

/** Does the segment `s`->`e` meet the closed hexagon of `h`? Independent re-check. */
function segmentHitsHex(s: Cube, e: Cube, h: Cube): boolean {
  const abc = (c: Cube) => [c.x - c.y, c.y - c.z, c.z - c.x] as const;
  const [a0, b0, c0] = abc(s);
  const [a1, b1, c1] = abc(e);
  const [ac, bc, cc] = abc(h);
  const froms = [a0, b0, c0];
  const deltas = [a1 - a0, b1 - b0, c1 - c0];
  const centres = [ac, bc, cc];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 3; i++) {
    const v0 = froms[i]!;
    const dv = deltas[i]!;
    const min = centres[i]! - 1;
    const max = centres[i]! + 1;
    if (Math.abs(dv) < 1e-9) {
      if (v0 < min - 1e-9 || v0 > max + 1e-9) return false;
      continue;
    }
    let tMin = (min - v0) / dv;
    let tMax = (max - v0) / dv;
    if (tMin > tMax) [tMin, tMax] = [tMax, tMin];
    lo = Math.max(lo, tMin);
    hi = Math.min(hi, tMax);
  }
  return lo <= hi + 1e-9;
}

const origin = cube(0, 0, 0);

describe("lineCoverageCubes", () => {
  it("returns only the start when start equals end", () => {
    expect(lineCoverageCubes(origin, cube(0, 0, 0))).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it("returns exactly the two hexes for an adjacent pair, start first", () => {
    const result = lineCoverageCubes(origin, cube(1, 0, -1));
    expect(result).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: -1 },
    ]);
  });

  it("covers only the collinear hexes for an axis-aligned run", () => {
    const result = lineCoverageCubes(origin, cube(3, 0, -3));
    expect(result).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: -1 },
      { x: 2, y: 0, z: -2 },
      { x: 3, y: 0, z: -3 },
    ]);
  });

  it("returns both hexes flanking a shared edge the segment runs along", () => {
    const result = lineCoverageCubes(origin, cube(2, -1, -1));
    expect(keys(result)).toEqual(
      keys([
        cube(0, 0, 0),
        cube(1, 0, -1),
        cube(1, -1, 0),
        cube(2, -1, -1),
      ]),
    );
  });

  it("every returned hex actually intersects the segment", () => {
    const start = cube(-2, 5, -3);
    const end = cube(4, -1, -3);
    for (const h of lineCoverageCubes(start, end)) {
      expect(segmentHitsHex(start, end, h)).toBe(true);
    }
  });

  it("orders results by non-decreasing entry parameter", () => {
    const start = origin;
    const end = cube(6, -4, -2);
    const result = lineCoverageCubes(start, end);
    // Reconstruct each hex's entry parameter and check it is sorted.
    const abc = (c: Cube) => [c.x - c.y, c.y - c.z, c.z - c.x] as const;
    const [a0, b0, c0] = abc(start);
    const [a1, b1, c1] = abc(end);
    const enters = result.map((h) => {
      const [ac, bc, cc] = abc(h);
      const froms = [a0, b0, c0];
      const deltas = [a1 - a0, b1 - b0, c1 - c0];
      const centres = [ac, bc, cc];
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 3; i++) {
        const dv = deltas[i]!;
        if (Math.abs(dv) < 1e-9) continue;
        let tMin = (centres[i]! - 1 - froms[i]!) / dv;
        let tMax = (centres[i]! + 1 - froms[i]!) / dv;
        if (tMin > tMax) [tMin, tMax] = [tMax, tMin];
        lo = Math.max(lo, tMin);
        hi = Math.min(hi, tMax);
      }
      return lo;
    });
    expect(enters).toEqual([...enters].sort((a, b) => a - b));
  });

  it("is symmetric as a set when the endpoints are swapped", () => {
    const a = cube(-3, 1, 2);
    const b = cube(4, -6, 2);
    expect(keys(lineCoverageCubes(a, b))).toEqual(keys(lineCoverageCubes(b, a)));
  });

  it("works away from the grid centre", () => {
    const start = cube(5, -2);
    const end = cube(8, -3, -5);
    const result = lineCoverageCubes(start, end);
    expect(result[0]).toEqual({ x: 5, y: -2, z: -3 });
    expect(result.at(-1)).toEqual({ x: 8, y: -3, z: -5 });
    for (const h of result) expect(segmentHitsHex(start, end, h)).toBe(true);
  });
});
