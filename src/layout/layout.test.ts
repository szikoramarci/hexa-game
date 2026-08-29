import { describe, expect, it } from "vitest";
import { cube, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { cubeRound, cubeToPixel, pixelToCube } from "./layout.js";

/** Every hex of the disc of the given radius. */
function disc(radius: number): Cube[] {
  const hexes: Cube[] = [];
  for (let x = -radius; x <= radius; x++) {
    const yMin = Math.max(-radius, -x - radius);
    const yMax = Math.min(radius, -x + radius);
    for (let y = yMin; y <= yMax; y++) hexes.push(cube(x, y));
  }
  return hexes;
}

describe("cubeToPixel", () => {
  it("puts the origin at (0, 0)", () => {
    expect(cubeToPixel(cube(0, 0, 0))).toEqual({ x: 0, y: 0 });
  });

  it("scales linearly with size", () => {
    const a = cubeToPixel(cube(2, -1, -1), 10);
    const b = cubeToPixel(cube(2, -1, -1), 20);
    expect(b.x).toBeCloseTo(a.x * 2);
    expect(b.y).toBeCloseTo(a.y * 2);
  });
});

describe("cubeRound", () => {
  it("leaves an exact hex untouched", () => {
    expect(cubeRound(2, -3, 1)).toEqual({ x: 2, y: -3, z: 1 });
  });

  it("snaps a fractional cube to the nearest hex and keeps the constraint", () => {
    const r = cubeRound(0.1, -0.8, 0.7);
    expect(r.x + r.y + r.z).toBe(0);
    expect(r).toEqual({ x: 0, y: -1, z: 1 });
  });

  it("normalises negative zero", () => {
    expect(Object.is(cubeRound(-0.1, 0.05, 0.05).x, 0)).toBe(true);
  });
});

describe("pixelToCube", () => {
  it("round-trips every integer hex of a radius-6 disc", () => {
    for (const size of [12, 26, 40]) {
      for (const hex of disc(6)) {
        const p = cubeToPixel(hex, size);
        expect(cubeKey(pixelToCube(p.x, p.y, size))).toBe(cubeKey(hex));
      }
    }
  });

  it("maps a point near a centre to that hex", () => {
    const c = cube(3, -1, -2);
    const p = cubeToPixel(c);
    expect(cubeKey(pixelToCube(p.x + 3, p.y - 4))).toBe(cubeKey(c));
  });
});
