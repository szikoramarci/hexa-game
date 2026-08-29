import { CUBE_DIRECTIONS, cubeAdd, cubeKey, type Cube } from "../coordinates/coordinates.js";

/**
 * All hexes a piece standing on `origin` can reach in at most `steps` moves,
 * where each move steps to an adjacent hex and `obstacles` may not be entered.
 *
 * The result is a breadth-first flood fill: `origin` first, then every hex at
 * distance 1, then distance 2, and so on. `origin` is always included (distance
 * 0), even when it is itself listed as an obstacle — the piece is already there.
 *
 * @param origin    The starting hex. Assumed to have integer coordinates.
 * @param steps     Movement budget. Must be a non-negative integer.
 * @param obstacles Hexes that block movement. Duplicates and the origin are
 *                  tolerated. Defaults to none.
 * @returns A fresh array of reachable hexes, ordered by increasing distance.
 *          Build `new Set(result.map(cubeKey))` for O(1) membership checks.
 */
export function reachableCubes(
  origin: Cube,
  steps: number,
  obstacles: Iterable<Cube> = [],
): Cube[] {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError(`steps must be a non-negative integer, got ${steps}`);
  }

  const blocked = new Set<string>();
  for (const o of obstacles) blocked.add(cubeKey(o));

  const start: Cube = { x: origin.x, y: origin.y, z: origin.z };
  const visited = new Set<string>([cubeKey(start)]);
  const result: Cube[] = [start];

  let frontier: Cube[] = [start];
  for (let d = 0; d < steps && frontier.length > 0; d++) {
    const next: Cube[] = [];
    for (const hex of frontier) {
      for (const dir of CUBE_DIRECTIONS) {
        const neighbor = cubeAdd(hex, dir);
        const key = cubeKey(neighbor);
        if (visited.has(key) || blocked.has(key)) continue;
        visited.add(key);
        result.push(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  return result;
}
