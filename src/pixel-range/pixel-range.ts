import { cubeKey, type Cube } from "../coordinates/coordinates.js";

/** Pointy-top pixel centre at unit size. Cube -> axial is `q = x`, `r = z`. */
function toPixel(c: Cube): { px: number; py: number } {
  return { px: Math.sqrt(3) * (c.x + c.z / 2), py: 1.5 * c.z };
}

/** Distance in pixels between two hex centres (unit size). */
function pixelDistance(a: Cube, b: Cube): number {
  const pa = toPixel(a);
  const pb = toPixel(b);
  return Math.hypot(pa.px - pb.px, pa.py - pb.py);
}

/** Neighbour centre-to-centre spacing at unit size. */
const SPACING = Math.sqrt(3);

/** Absolute slack so hexes sitting exactly on the circle are kept. */
const EPSILON = 1e-9;

/**
 * All hexes whose **centre point** lies within a circle of `range` adjacent-hex
 * spacings around `center`'s centre.
 *
 * This is a Euclidean ball in pixel space, not a hex-distance disc: the region
 * is a rounded hexagon that bulges past the hex-distance range at edge midpoints
 * as `range` grows. `range = 1` reaches exactly the six immediate neighbours;
 * `range = 0` returns just `center`. Fractional values are allowed.
 *
 * @param center The hex the circle is centred on. Assumed integer coordinates.
 * @param range  Radius in adjacent-hex spacings. Must be finite and >= 0.
 * @returns A fresh array ordered by increasing pixel distance from `center`
 *          (ties broken by coordinate key). `center` is always first.
 */
export function pixelRangeCubes(center: Cube, range: number): Cube[] {
  if (!Number.isFinite(range) || range < 0) {
    throw new RangeError(`range must be a finite non-negative number, got ${range}`);
  }

  const radiusPx = range * SPACING;
  // Any hex whose centre is within `radiusPx` sits within this cube distance.
  const search = Math.ceil(2 * range) + 2;

  const hits: { hex: Cube; dist: number }[] = [];
  for (let dx = -search; dx <= search; dx++) {
    const yMin = Math.max(-search, -dx - search);
    const yMax = Math.min(search, -dx + search);
    for (let dy = yMin; dy <= yMax; dy++) {
      const hex: Cube = {
        x: center.x + dx,
        y: center.y + dy,
        z: center.z - dx - dy,
      };
      const dist = pixelDistance(center, hex);
      if (dist <= radiusPx + EPSILON) hits.push({ hex, dist });
    }
  }

  hits.sort((a, b) => a.dist - b.dist || cubeKey(a.hex).localeCompare(cubeKey(b.hex)));
  return hits.map((h) => h.hex);
}
