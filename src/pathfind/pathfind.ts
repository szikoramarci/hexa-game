import {
  CUBE_DIRECTIONS,
  cubeAdd,
  cubeEquals,
  cubeKey,
  type Cube,
} from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";

/**
 * The shortest hex path from `start` to `end` that never steps onto a blocked
 * hex — plain A* on the 6-neighbour grid with unit step cost.
 *
 * The result includes **both endpoints**: `start` first, `end` last, every
 * consecutive pair adjacent, and no hex in `obstacles` (bar the endpoints, see
 * below). With a clear line the length is `cubeDistance(start, end) + 1`.
 *
 * Obstacles equal to `start` or `end` are ignored: the piece may leave the hex
 * it stands on and may finish on the target. When `start` equals `end` the
 * result is `[start]`, even if that hex is listed as an obstacle.
 *
 * The heuristic is the cube distance to `end` — admissible and consistent — so
 * the first time `end` is settled the path to it is optimal. The frontier is
 * ordered by `(f, h, cubeKey)` and neighbours are generated in
 * `CUBE_DIRECTIONS` order, so ties between equal-length routes always resolve
 * the same way and the output is deterministic.
 *
 * @param start     Where the path begins. Assumed integer coordinates.
 * @param end       Where the path ends. Assumed integer coordinates.
 * @param obstacles Hexes that may not be entered. Duplicates and the endpoints
 *                  are tolerated. Defaults to none.
 * @returns A fresh array of hexes from `start` to `end`, or `null` when no
 *          route exists (an endpoint is walled off on every side).
 */
export function pathCubes(
  start: Cube,
  end: Cube,
  obstacles: Iterable<Cube> = [],
): Cube[] | null {
  const from: Cube = { x: start.x, y: start.y, z: start.z };
  if (cubeEquals(start, end)) return [from];

  const blocked = new Set<string>();
  // Confine the search to the bounding box of the endpoints and every obstacle,
  // expanded by one hex. Outside that box the grid is open, so no shortest path
  // ever needs to leave it — and without this bound an enclosed `end` would send
  // A* across the whole infinite plane.
  let xMin = Math.min(start.x, end.x);
  let xMax = Math.max(start.x, end.x);
  let yMin = Math.min(start.y, end.y);
  let yMax = Math.max(start.y, end.y);
  let zMin = Math.min(start.z, end.z);
  let zMax = Math.max(start.z, end.z);
  for (const o of obstacles) {
    blocked.add(cubeKey(o));
    xMin = Math.min(xMin, o.x);
    xMax = Math.max(xMax, o.x);
    yMin = Math.min(yMin, o.y);
    yMax = Math.max(yMax, o.y);
    zMin = Math.min(zMin, o.z);
    zMax = Math.max(zMax, o.z);
  }
  blocked.delete(cubeKey(start));
  blocked.delete(cubeKey(end));

  const inBounds = (c: Cube): boolean =>
    c.x >= xMin - 1 && c.x <= xMax + 1 &&
    c.y >= yMin - 1 && c.y <= yMax + 1 &&
    c.z >= zMin - 1 && c.z <= zMax + 1;

  const endKey = cubeKey(end);

  const gScore = new Map<string, number>([[cubeKey(from), 0]]);
  const cameFrom = new Map<string, Cube>();
  const settled = new Set<string>();

  interface Node {
    hex: Cube;
    key: string;
    g: number;
    h: number;
    f: number;
  }
  const h0 = cubeDistance(from, end);
  const open: Node[] = [{ hex: from, key: cubeKey(from), g: 0, h: h0, f: h0 }];

  while (open.length > 0) {
    // Pop the frontier node with the lowest (f, h, key).
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      const n = open[i]!;
      const b = open[best]!;
      if (n.f < b.f || (n.f === b.f && (n.h < b.h || (n.h === b.h && n.key < b.key)))) {
        best = i;
      }
    }
    const current = open.splice(best, 1)[0]!;
    if (settled.has(current.key)) continue;
    settled.add(current.key);

    if (current.key === endKey) {
      const path: Cube[] = [current.hex];
      let step = current.key;
      while (cameFrom.has(step)) {
        const prev = cameFrom.get(step)!;
        path.push(prev);
        step = cubeKey(prev);
      }
      path.reverse();
      return path;
    }

    for (const dir of CUBE_DIRECTIONS) {
      const neighbor = cubeAdd(current.hex, dir);
      const key = cubeKey(neighbor);
      if (blocked.has(key) || settled.has(key) || !inBounds(neighbor)) continue;
      const tentativeG = current.g + 1;
      const knownG = gScore.get(key);
      if (knownG !== undefined && tentativeG >= knownG) continue;
      gScore.set(key, tentativeG);
      cameFrom.set(key, current.hex);
      const hh = cubeDistance(neighbor, end);
      open.push({ hex: neighbor, key, g: tentativeG, h: hh, f: tentativeG + hh });
    }
  }

  return null;
}
