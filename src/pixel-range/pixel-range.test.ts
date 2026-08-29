import { describe, expect, it } from "vitest";
import { cube, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { pixelRangeCubes } from "./pixel-range.js";

const keys = (cs: Cube[]) => new Set(cs.map(cubeKey));
const cubeDistance = (a: Cube, b: Cube) =>
  (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2;

/** The hex-distance disc of the given radius around `center`. */
function hexDisc(center: Cube, radius: number): Cube[] {
  const hexes: Cube[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    const yMin = Math.max(-radius, -dx - radius);
    const yMax = Math.min(radius, -dx + radius);
    for (let dy = yMin; dy <= yMax; dy++) {
      hexes.push({ x: center.x + dx, y: center.y + dy, z: center.z - dx - dy });
    }
  }
  return hexes;
}

const origin = cube(0, 0, 0);

describe("pixelRangeCubes", () => {
  it("returns only the centre for range 0", () => {
    expect(pixelRangeCubes(origin, 0)).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it("reaches exactly the six neighbours at range 1", () => {
    const result = pixelRangeCubes(origin, 1);
    expect(result).toHaveLength(7);
    expect(keys(result)).toEqual(keys(hexDisc(origin, 1)));
  });

  it("covers the whole 19-hex disc through ring 2, and nothing from ring 3", () => {
    const result = pixelRangeCubes(origin, 2);
    expect(keys(result)).toEqual(keys(hexDisc(origin, 2)));
  });

  it("is a strict superset of the hex disc and bulges past it at large range", () => {
    const result = pixelRangeCubes(origin, 8);
    const disc = keys(hexDisc(origin, 8));
    for (const k of disc) expect(keys(result).has(k)).toBe(true);
    const beyond = result.filter((h) => cubeDistance(origin, h) > 8);
    expect(beyond.length).toBeGreaterThan(0);
    // The bulge is at edge midpoints, never at corners.
    expect(beyond.every((h) => cubeDistance(origin, h) === 9)).toBe(true);
  });

  it("orders results by non-decreasing pixel distance from the centre", () => {
    const px = (c: Cube) => Math.sqrt(3) * (c.x + c.z / 2);
    const py = (c: Cube) => 1.5 * c.z;
    const d = (c: Cube) => Math.hypot(px(c), py(c));
    const distances = pixelRangeCubes(origin, 5).map(d);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("works away from the grid centre", () => {
    const center = cube(4, -1);
    const result = pixelRangeCubes(center, 3);
    expect(result[0]).toEqual({ x: 4, y: -1, z: -3 });
    expect(result).toHaveLength(pixelRangeCubes(origin, 3).length);
  });

  it("rejects a negative, NaN, or infinite range", () => {
    expect(() => pixelRangeCubes(origin, -1)).toThrow(RangeError);
    expect(() => pixelRangeCubes(origin, NaN)).toThrow(RangeError);
    expect(() => pixelRangeCubes(origin, Infinity)).toThrow(RangeError);
  });
});
