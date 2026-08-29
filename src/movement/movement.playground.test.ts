import { describe, expect, it } from "vitest";
import {
  CUBE_DIRECTIONS,
  cube,
  cubeAdd,
  cubeKey,
  type Cube,
} from "../coordinates/coordinates.js";
import { disc } from "../test-utils/board.js";
import {
  writeMovementPlayground,
  type MovementCase,
} from "../test-utils/movement-playground.js";
import { reachableCubes } from "./movement.js";

const origin = cube(0, 0, 0);

/** Straight line of `count` hexes from `from`, stepping by `dir`. */
function wall(from: Cube, dir: Cube, count: number): Cube[] {
  return Array.from({ length: count }, (_, i) =>
    cube(from.x + dir.x * i, from.y + dir.y * i, from.z + dir.z * i),
  );
}

const SE = cube(0, 1, -1);
const N = cube(0, -1, 1);

const CASES: MovementCase[] = [
  {
    title: "open field — a 2-hex step",
    play: { radius: 4, piece: { at: origin, label: 1 }, budget: 2 },
  },
  {
    title: "open field — the 4-hex move",
    play: { radius: 6, piece: { at: origin, label: 1 }, budget: 4 },
  },
  {
    title: "one pillar beside the piece",
    play: {
      radius: 5,
      piece: { at: origin, label: 3 },
      budget: 4,
      obstacle: [cube(1, -1, 0)],
    },
  },
  {
    title: "walled off but for one gap",
    play: {
      radius: 6,
      piece: { at: origin, label: 4 },
      budget: 4,
      obstacle: [
        cube(1, 0, -1),
        cube(0, 1, -1),
        cube(-1, 1, 0),
        cube(-1, 0, 1),
        cube(0, -1, 1),
      ],
    },
  },
  {
    title: "scattered obstacles",
    play: {
      radius: 6,
      piece: { at: origin, label: 7 },
      budget: 4,
      obstacle: [
        cube(2, -1, -1),
        cube(-1, 2, -1),
        cube(-2, 0, 2),
        cube(1, 1, -2),
        cube(0, -2, 2),
      ],
    },
  },
  {
    title: "threading an S-corridor — 5 hexes",
    play: {
      radius: 7,
      piece: { at: cube(-4, 2, 2), label: 5 },
      budget: 5,
      obstacle: [
        ...wall(cube(-3, 0, 3), SE, 5),
        ...wall(cube(1, -1, 0), N, 5),
        ...wall(cube(-1, 3, -2), SE, 4),
      ],
    },
  },
];

describe("movement playground page", () => {
  const html = writeMovementPlayground(
    "movement",
    "piece movement",
    "The first action: move a piece across the board.",
    CASES,
  );

  it("puts every case on the one page", () => {
    for (let i = 0; i < CASES.length; i++) {
      expect(html).toContain(`id="case-${i}"`);
      expect(html).toContain(`<h2>${CASES[i]!.title}</h2>`);
    }
    expect(html).toContain('href="../../index.html"');
  });

  it("bakes a reachable region for each case", () => {
    for (const c of CASES) {
      const obstacles = [...(c.play.obstacle ?? [])];
      const targets = reachableCubes(
        c.play.piece.at,
        c.play.budget,
        obstacles,
      ).filter((h) => cubeKey(h) !== cubeKey(c.play.piece.at));
      expect(targets.length).toBeGreaterThan(0);
    }
  });

  it("the inline BFS matches reachableCubes clipped to the board", () => {
    // Mirror of flood() in movement-playground.ts. If it drifts from
    // reachableCubes the interactive highlight would lie.
    const budget = 3;
    const obstacles = [cube(1, -1, 0), cube(-1, 0, 1), cube(0, 1, -1)];
    const board = new Set(disc(4).map(cubeKey));
    const blocked = new Set(obstacles.map(cubeKey));

    const dist = new Set([cubeKey(origin)]);
    let frontier = [origin];
    for (let d = 0; d < budget && frontier.length; d++) {
      const next: Cube[] = [];
      for (const hex of frontier) {
        for (const dir of CUBE_DIRECTIONS) {
          const nb = cubeAdd(hex, dir);
          const nk = cubeKey(nb);
          if (dist.has(nk) || blocked.has(nk) || !board.has(nk)) continue;
          dist.add(nk);
          next.push(nb);
        }
      }
      frontier = next;
    }

    const expected = new Set(
      reachableCubes(origin, budget, obstacles)
        .map(cubeKey)
        .filter((k) => board.has(k)),
    );
    expect(dist).toEqual(expected);
  });
});
