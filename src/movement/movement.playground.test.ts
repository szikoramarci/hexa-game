import { describe, expect, it } from "vitest";
import { cube, cubeKey, type Cube } from "../coordinates/coordinates.js";
import {
  movePath,
  reachableForPiece,
  type MoveActionState,
} from "../move-action/move-action.js";
import {
  writeMovementPlayground,
  type MovementCase,
} from "../test-utils/movement-playground.js";

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
    play: { radius: 4, pieces: [{ at: origin, label: 1, movePoints: 2 }] },
  },
  {
    title: "open field — the 4-hex move",
    play: { radius: 6, pieces: [{ at: origin, label: 1, movePoints: 4 }] },
  },
  {
    title: "one pillar beside the piece",
    play: {
      radius: 5,
      pieces: [{ at: origin, label: 3, movePoints: 4 }],
      obstacle: [cube(1, -1, 0)],
    },
  },
  {
    title: "walled off but for one gap",
    play: {
      radius: 6,
      pieces: [{ at: origin, label: 4, movePoints: 4 }],
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
      pieces: [{ at: origin, label: 7, movePoints: 4 }],
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
      pieces: [{ at: cube(-4, 2, 2), label: 5, movePoints: 5 }],
      obstacle: [
        ...wall(cube(-3, 0, 3), SE, 5),
        ...wall(cube(1, -1, 0), N, 5),
        ...wall(cube(-1, 3, -2), SE, 4),
      ],
    },
  },
  {
    title: "two pieces — B stands in A's way",
    play: {
      radius: 5,
      pieces: [
        { at: cube(-1, 0, 1), label: "A", movePoints: 2 },
        { at: origin, label: "B", movePoints: 2 },
      ],
    },
  },
];

/** The `MoveActionState` a case's first piece would see. */
function caseState(c: MovementCase): MoveActionState {
  return {
    pieces: c.play.pieces.map((p, i) => ({
      id: `case-p${i}`,
      label: p.label,
      at: p.at,
      movePoints: p.movePoints,
    })),
    obstacles: [...(c.play.obstacle ?? [])],
    piecesBlock: c.play.piecesBlock,
  };
}

describe("movement playground page", () => {
  const html = writeMovementPlayground(
    "movement",
    "piece movement",
    "The first action layer, built on move-action.",
    CASES,
  );

  it("puts every case on the one page", () => {
    for (let i = 0; i < CASES.length; i++) {
      expect(html).toContain(`id="case-${i}"`);
      expect(html).toContain(`<h2>${CASES[i]!.title}</h2>`);
    }
    expect(html).toContain('href="../../index.html"');
    expect(html).toContain('data-id="case-6-p1"'); // the two-piece case
  });

  it("every case gives its first piece somewhere to go", () => {
    for (const c of CASES) {
      expect(reachableForPiece(caseState(c), "case-p0").length).toBeGreaterThan(0);
    }
  });

  it("a blocking piece removes the hex right behind it", () => {
    // two-piece case: A at (-1,0,1), B at (0,0,0), A has 2 MP.
    const state = caseState(CASES[6]!);
    const reach = new Set(reachableForPiece(state, "case-p0").map(cubeKey));
    expect(reach.has(cubeKey(origin))).toBe(false); // B's hex
    expect(reach.has(cubeKey(cube(1, 0, -1)))).toBe(false); // straight past B, detour > 2
    expect(reach.has(cubeKey(cube(1, -1, 0)))).toBe(true); // reachable around B
  });

  it("the inline flood mirrors move-action for a representative board", () => {
    // The same BFS the inline script runs, checked against reachableForPiece /
    // movePath — drift here would make the playground lie.
    const state = caseState(CASES[3]!); // walled off but for one gap
    const piece = state.pieces[0]!;
    const board = new Set<string>();
    for (let x = -6; x <= 6; x++) {
      for (let y = Math.max(-6, -x - 6); y <= Math.min(6, -x + 6); y++) {
        board.add(cubeKey(cube(x, y)));
      }
    }
    const blocked = new Set(state.obstacles.map(cubeKey));
    const DIRS = [
      [1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1],
    ] as const;

    const dist = new Map<string, number>([[cubeKey(piece.at), 0]]);
    const cameFrom = new Map<string, string>();
    let frontier = [cubeKey(piece.at)];
    for (let d = 0; d < piece.movePoints && frontier.length; d++) {
      const next: string[] = [];
      for (const key of frontier) {
        const [x, y, z] = key.split(",").map(Number) as [number, number, number];
        for (const [dx, dy, dz] of DIRS) {
          const nk = `${x + dx},${y + dy},${z + dz}`;
          if (dist.has(nk) || blocked.has(nk) || !board.has(nk)) continue;
          dist.set(nk, d + 1);
          cameFrom.set(nk, key);
          next.push(nk);
        }
      }
      frontier = next;
    }

    const inlineReach = new Set([...dist.keys()].filter((k) => k !== cubeKey(piece.at)));
    const realReach = new Set(reachableForPiece(state, "case-p0").map(cubeKey));
    expect(inlineReach).toEqual(realReach);

    // The inline BFS path and movePath may pick different *equal-length*
    // shortest routes; both must be the same length and end at the target.
    const target = [...inlineReach][inlineReach.size - 1]!;
    const walk = (t: string): string[] => {
      const p = [t];
      let s = t;
      while (cameFrom.has(s)) {
        s = cameFrom.get(s)!;
        p.unshift(s);
      }
      return p;
    };
    const [tx, ty, tz] = target.split(",").map(Number) as [number, number, number];
    const real = movePath(state, "case-p0", cube(tx, ty, tz))!;
    const inline = walk(target);
    expect(inline).toHaveLength(real.length);
    expect(inline[0]).toBe(cubeKey(piece.at));
    expect(inline.at(-1)).toBe(target);
  });
});
