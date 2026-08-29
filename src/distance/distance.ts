import type { Cube } from "../coordinates/coordinates.js";

/**
 * Cube distance — the minimum number of single-hex steps between `a` and `b`.
 *
 * On the plane `x + y + z = 0` this is `(|dx| + |dy| + |dz|) / 2`, equivalently
 * `max(|dx|, |dy|, |dz|)`. Always a non-negative integer for integer cubes.
 */
export function cubeDistance(a: Cube, b: Cube): number {
  return (
    (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2
  );
}
