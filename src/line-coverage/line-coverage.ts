import { cubeEquals, cubeKey, type Cube } from "../coordinates/coordinates.js";

/** Absolute slack so edge and corner grazes are kept as "covered". */
const EPSILON = 1e-9;

/** The three edge-family coordinates of a point: `a = x - y`, `b = y - z`, `c = z - x`. */
interface Abc {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

function abc(c: Cube): Abc {
  return { a: c.x - c.y, b: c.y - c.z, c: c.z - c.x };
}

/**
 * Clip the segment parameter `t in [0, 1]` against the closed hexagon of centre
 * `cen`. For a pointy-top hex the region is exactly
 * `a in [aC-1, aC+1]`, `b in [bC-1, bC+1]`, `c in [cC-1, cC+1]`, and each `a(t)`,
 * `b(t)`, `c(t)` is linear, so this is a Liang–Barsky clip.
 *
 * @returns the entry parameter (`lo`) if the segment meets the hexagon within
 *          `EPSILON` — grazing an edge or corner counts — otherwise `null`.
 */
function entryParam(from: Abc, delta: Abc, cen: Abc): number | null {
  let lo = 0;
  let hi = 1;
  for (const k of ["a", "b", "c"] as const) {
    const v0 = from[k];
    const dv = delta[k];
    const min = cen[k] - 1;
    const max = cen[k] + 1;
    if (Math.abs(dv) < EPSILON) {
      if (v0 < min - EPSILON || v0 > max + EPSILON) return null;
      continue;
    }
    let tMin = (min - v0) / dv;
    let tMax = (max - v0) / dv;
    if (tMin > tMax) [tMin, tMax] = [tMax, tMin];
    if (tMin > lo) lo = tMin;
    if (tMax < hi) hi = tMax;
    if (lo > hi + EPSILON) return null;
  }
  return lo;
}

/**
 * Every hex the straight segment between `start`'s and `end`'s **centres**
 * passes through — the *supercover* line.
 *
 * A hex is covered when the segment intersects its closed hexagon, so touching
 * an edge or a corner is enough: crossing a shared edge returns **both**
 * neighbouring hexes, and a segment running along a shared edge returns both
 * hexes that flank it. This is wider than a lerp-and-round line, which picks one
 * hex per step.
 *
 * The cube -> pixel map is affine, so a straight segment in pixel space is a
 * straight segment in cube space; the work happens entirely in cube space.
 * Pointy-top orientation, matching the scenario renderer.
 *
 * @param start One endpoint. Assumed integer coordinates.
 * @param end   The other endpoint. Assumed integer coordinates.
 * @returns A fresh array ordered by the parameter at which the segment enters
 *          each hex (ties broken by `cubeKey`). `start` is always first; when
 *          `start` equals `end` the result is just `[start]`.
 */
export function lineCoverageCubes(start: Cube, end: Cube): Cube[] {
  const first: Cube = { x: start.x, y: start.y, z: start.z };
  if (cubeEquals(start, end)) return [first];

  const from = abc(start);
  const to = abc(end);
  const delta: Abc = { a: to.a - from.a, b: to.b - from.b, c: to.c - from.c };

  // A covered hex centre sits within 2/3 of the segment on every axis, and the
  // segment stays inside its endpoints' bounding box, so +1 slack is plenty.
  const xMin = Math.min(start.x, end.x) - 1;
  const xMax = Math.max(start.x, end.x) + 1;
  const yMin = Math.min(start.y, end.y) - 1;
  const yMax = Math.max(start.y, end.y) + 1;
  const zMin = Math.min(start.z, end.z) - 1;
  const zMax = Math.max(start.z, end.z) + 1;

  const hits: { hex: Cube; enter: number }[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const z = 0 - x - y;
      if (z < zMin || z > zMax) continue;
      const hex: Cube = { x, y, z };
      const enter = entryParam(from, delta, abc(hex));
      if (enter !== null) hits.push({ hex, enter });
    }
  }

  hits.sort(
    (p, q) => p.enter - q.enter || cubeKey(p.hex).localeCompare(cubeKey(q.hex)),
  );
  return hits.map((h) => h.hex);
}
