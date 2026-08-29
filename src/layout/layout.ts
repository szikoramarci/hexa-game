import { cube, type Cube } from "../coordinates/coordinates.js";

/** Default hex centre-to-corner distance in pixels (matches the renderer). */
export const DEFAULT_HEX_SIZE = 26;

/** A point in the SVG pixel plane. */
export interface Pixel {
  x: number;
  y: number;
}

/**
 * Pointy-top cube -> pixel centre. Cube -> axial is `q = x`, `r = z`, so
 * `px = size * sqrt(3) * (x + z / 2)` and `py = size * 1.5 * z`. This is the one
 * true layout map — the scenario renderer and {@link hexArrow} both use it.
 *
 * @param c    Hex, integer or fractional coordinates.
 * @param size Centre-to-corner distance in pixels. Default {@link DEFAULT_HEX_SIZE}.
 */
export function cubeToPixel(c: Cube, size: number = DEFAULT_HEX_SIZE): Pixel {
  return {
    x: size * Math.sqrt(3) * (c.x + c.z / 2),
    y: size * 1.5 * c.z,
  };
}

/**
 * Snap a fractional cube to the nearest hex: round each axis, then nudge the
 * axis whose value moved furthest so the result satisfies `x + y + z = 0`.
 */
export function cubeRound(x: number, y: number, z: number): Cube {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  // Normalise -0 to 0 so keys and equality stay stable.
  return cube(rx + 0, ry + 0, rz + 0);
}

/**
 * Inverse of {@link cubeToPixel}: the hex whose centre is closest to `(px, py)`.
 * Undoes the pointy-top map, then {@link cubeRound}s the fractional result.
 */
export function pixelToCube(
  px: number,
  py: number,
  size: number = DEFAULT_HEX_SIZE,
): Cube {
  const z = py / (1.5 * size);
  const x = px / (size * Math.sqrt(3)) - z / 2;
  return cubeRound(x, -x - z, z);
}
