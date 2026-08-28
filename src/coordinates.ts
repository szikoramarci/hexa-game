/**
 * Cube coordinates for a hex grid.
 *
 * Every hex is a point `(x, y, z)` on the plane `x + y + z = 0`.
 * The grid centre is `(0, 0, 0)`. See https://www.redblobgames.com/grids/hexagons/.
 */
export interface Cube {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Small tolerance used when validating the `x + y + z = 0` constraint. */
export const CUBE_EPSILON = 1e-9;

/**
 * Build a {@link Cube}. When `z` is omitted it is derived as `-x - y`.
 * Throws if the resulting coordinate does not satisfy `x + y + z = 0`.
 */
export function cube(x: number, y: number, z: number = -x - y): Cube {
  const sum = x + y + z;
  if (!Number.isFinite(sum) || Math.abs(sum) > CUBE_EPSILON) {
    throw new RangeError(`Invalid cube coordinate: (${x}, ${y}, ${z}) must satisfy x + y + z = 0`);
  }
  return { x, y, z };
}

/** Runtime type guard for a valid {@link Cube}. */
export function isCube(value: unknown): value is Cube {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c["x"] !== "number" || typeof c["y"] !== "number" || typeof c["z"] !== "number") {
    return false;
  }
  const sum = c["x"] + c["y"] + c["z"];
  return Number.isFinite(sum) && Math.abs(sum) <= CUBE_EPSILON;
}

/** True when `a` and `b` refer to the same hex. */
export function cubeEquals(a: Cube, b: Cube): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Stable string key for use in `Set` / `Map`. */
export function cubeKey(c: Cube): string {
  return `${c.x},${c.y},${c.z}`;
}

/** Vector addition. */
export function cubeAdd(a: Cube, b: Cube): Cube {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Vector subtraction (`a - b`). */
export function cubeSubtract(a: Cube, b: Cube): Cube {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Scalar multiplication. */
export function cubeScale(c: Cube, factor: number): Cube {
  return { x: c.x * factor, y: c.y * factor, z: c.z * factor };
}

/**
 * The six unit direction vectors, ordered counter-clockwise starting from "east"
 * (`+x / -y`). Index this array to walk or rotate around the grid.
 */
export const CUBE_DIRECTIONS: readonly Cube[] = [
  { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 },
  { x: -1, y: 0, z: 1 },
  { x: 0, y: -1, z: 1 },
] as const;
