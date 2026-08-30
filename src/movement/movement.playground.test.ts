import { describe, expect, it } from "vitest";
import { cube, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { seedRng } from "../dice/dice.js";
import { looseBall } from "../loose-ball/loose-ball.js";
import {
  initMoveAction,
  moveAction,
  movePath,
  moveView,
  pathHazards,
  reachableForPiece,
  reachTackle,
  relocationOptions,
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
const HOME = "home";
const AWAY = "away";

const CASES: MovementCase[] = [
  {
    title: "open field — a 2-hex step",
    play: { radius: 4, pieces: [{ at: origin, label: 1, movePoints: 2, team: HOME }] },
  },
  {
    title: "open field — the 4-hex move",
    play: { radius: 6, pieces: [{ at: origin, label: 1, movePoints: 4, team: HOME }] },
  },
  {
    title: "one pillar beside the piece",
    play: {
      radius: 5,
      pieces: [{ at: origin, label: 3, movePoints: 4, team: HOME }],
      obstacle: [cube(1, -1, 0)],
    },
  },
  {
    title: "walled off but for one gap",
    play: {
      radius: 6,
      pieces: [{ at: origin, label: 4, movePoints: 4, team: HOME }],
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
    title: "threading an S-corridor — 5 hexes",
    play: {
      radius: 7,
      pieces: [{ at: cube(-4, 2, 2), label: 5, movePoints: 5, team: HOME }],
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
        { at: cube(-1, 0, 1), label: "A", movePoints: 2, team: HOME },
        { at: origin, label: "B", movePoints: 2, team: AWAY },
      ],
    },
  },
  {
    title: "carry the ball past a defender",
    play: {
      radius: 6,
      pieces: [
        { at: origin, label: 9, movePoints: 6, team: HOME, hasBall: true },
        { at: cube(3, -1, -2), label: "D", movePoints: 4, team: AWAY },
      ],
    },
  },
  {
    title: "run the gauntlet — a roll per defender you pass",
    play: {
      radius: 6,
      pieces: [
        { at: origin, label: 9, movePoints: 6, team: HOME, hasBall: true },
        { at: cube(1, -2, 1), label: "D", movePoints: 3, team: AWAY },
        { at: cube(1, 0, -1), label: "E", movePoints: 3, team: AWAY },
      ],
    },
  },
  {
    title: "close down the carrier — a hard tackle",
    play: {
      radius: 5,
      pieces: [
        { at: cube(3, -3, 0), label: "D", movePoints: 3, team: AWAY, attrs: { tackling: 5 } },
        { at: origin, label: 9, movePoints: 0, team: HOME, hasBall: true, attrs: { dribbling: 2 } },
      ],
    },
  },
  {
    title: "just out of reach — no tackle offered",
    play: {
      radius: 5,
      pieces: [
        { at: cube(3, -3, 0), label: "D", movePoints: 2, team: AWAY },
        { at: origin, label: 9, movePoints: 0, team: HOME, hasBall: true },
      ],
    },
  },
  {
    title: "the carrier rides the challenge",
    play: {
      radius: 5,
      pieces: [
        { at: cube(2, -2, 0), label: "D", movePoints: 3, team: AWAY, attrs: { tackling: 1 } },
        { at: origin, label: 9, movePoints: 0, team: HOME, hasBall: true, attrs: { dribbling: 6 } },
      ],
    },
  },
  {
    title: "shoulder to shoulder — even attributes",
    play: {
      radius: 4,
      pieces: [
        { at: cube(1, -1, 0), label: "D", movePoints: 2, team: AWAY },
        { at: origin, label: 9, movePoints: 0, team: HOME, hasBall: true },
      ],
    },
  },
  {
    title: "loose ball in a crowd — a tie spills it",
    play: {
      radius: 4,
      pieces: [
        { at: cube(1, -1, 0), label: "D", movePoints: 2, team: AWAY },
        { at: origin, label: 9, movePoints: 0, team: HOME, hasBall: true },
        { at: cube(-2, 1, 1), label: "E", movePoints: 0, team: AWAY },
        { at: cube(0, -2, 2), label: "F", movePoints: 0, team: AWAY },
        { at: cube(2, 0, -2), label: 7, movePoints: 0, team: HOME },
        { at: cube(-1, 2, -1), label: 8, movePoints: 0, team: HOME },
      ],
    },
  },
];

/** The `MoveActionState` for a case (piece ids `case-p0`, `case-p1`, …). */
function caseState(c: MovementCase): MoveActionState {
  const pieces = c.play.pieces.map((p, i) => ({
    id: `case-p${i}`,
    label: p.label,
    at: p.at,
    movePoints: p.movePoints,
    team: p.team,
    ...(p.attrs ? { attrs: p.attrs } : {}),
  }));
  const carrier = c.play.pieces.findIndex((p) => p.hasBall);
  const state: MoveActionState = {
    pieces,
    obstacles: [...(c.play.obstacle ?? [])],
    piecesBlock: c.play.piecesBlock,
    ...(c.play.defaultAttr != null ? { defaultAttr: c.play.defaultAttr } : {}),
  };
  return carrier >= 0 ? { ...state, ball: pieces[carrier]!.at } : state;
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
    expect(html).toContain('data-id="case-6-p1"');
    expect(html).toContain('class="ball"'); // a ball case is present
  });

  it("every case gives its first piece somewhere to go", () => {
    for (const c of CASES) {
      expect(reachableForPiece(caseState(c), "case-p0").length).toBeGreaterThan(0);
    }
  });

  it("a blocking piece removes the hex right behind it", () => {
    const state = caseState(CASES[5]!); // two pieces: A (2 MP) at (-1,0,1), B at (0,0,0)
    const reach = new Set(reachableForPiece(state, "case-p0").map(cubeKey));
    expect(reach.has(cubeKey(origin))).toBe(false);
    expect(reach.has(cubeKey(cube(1, 0, -1)))).toBe(false);
    expect(reach.has(cubeKey(cube(1, -1, 0)))).toBe(true);
  });

  it("the ball cases put the carrier at risk near a defender", () => {
    // carry-past: heading east to (3,0,-3) passes D's influence at (2,0,-2).
    const carry = caseState(CASES[6]!);
    const p1 = movePath(carry, "case-p0", cube(3, 0, -3))!;
    expect(pathHazards(carry, "case-p0", p1).map(cubeKey)).toContain(cubeKey(cube(2, 0, -2)));

    // gauntlet: the only way east threads (1,-1,0), adjacent to both D and E.
    const gauntlet = caseState(CASES[7]!);
    const p2 = movePath(gauntlet, "case-p0", cube(2, -1, -1))!;
    expect(pathHazards(gauntlet, "case-p0", p2).map(cubeKey)).toContain(cubeKey(cube(1, -1, 0)));
  });

  it("the inline flood mirrors move-action for a representative board", () => {
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
    let frontier = [cubeKey(piece.at)];
    for (let d = 0; d < piece.movePoints && frontier.length; d++) {
      const next: string[] = [];
      for (const key of frontier) {
        const [x, y, z] = key.split(",").map(Number) as [number, number, number];
        for (const [dx, dy, dz] of DIRS) {
          const nk = `${x + dx},${y + dy},${z + dz}`;
          if (dist.has(nk) || blocked.has(nk) || !board.has(nk)) continue;
          dist.set(nk, d + 1);
          next.push(nk);
        }
      }
      frontier = next;
    }

    const inlineReach = new Set([...dist.keys()].filter((k) => k !== cubeKey(piece.at)));
    const realReach = new Set(reachableForPiece(state, "case-p0").map(cubeKey));
    expect(inlineReach).toEqual(realReach);
  });

  it("each case's baked seed is seedRng(caseId), so the page replays", () => {
    for (let i = 0; i < CASES.length; i++) {
      expect(html).toContain(`"seed":${seedRng(`case-${i}`)}`);
    }
  });

  it("move-action resolves the gauntlet deterministically for the baked seed", () => {
    const state = caseState(CASES[7]!);
    const seed = seedRng("case-7");
    const play = () => {
      let s = initMoveAction(state, seed);
      s = moveAction(s, { type: "selectPiece", pieceId: "case-p0" });
      s = moveAction(s, { type: "commit", hex: cube(2, -1, -1) });
      let guard = 0;
      while (s.phase === "moving" && guard++ < 40) {
        s = moveAction(s, { type: "advance" });
      }
      return s;
    };
    const a = play();
    const b = play();
    expect(a.phase).toBe(b.phase);
    expect(a.steal).toEqual(b.steal);
    expect(["stopped", "aiming", "spent"]).toContain(a.phase);
  });
});

/** Case index by title (the tackle cases were appended). */
const idx = (title: string) => CASES.findIndex((c) => c.title === title);

describe("movement playground page — the tackle", () => {
  const html = writeMovementPlayground("movement", "piece movement", "x", CASES);

  it("ships the tackle affordances — stay button, target glow, relocation hex", () => {
    expect(html).toContain('class="stay"');
    expect(html).toContain(".tackle-target");
    expect(html).toContain(".hex.relo");
    expect(html).toContain("resolveChallenge");
    expect(html).toContain("reachTackle");
  });

  it("ships the loose-ball scatter — mirror fn, slate arrow, catcher glow", () => {
    expect(html).toContain("function looseBall(");
    expect(html).toContain("var SCATTER =");
    expect(html).toContain(".piece.caught");
    expect(html).toContain("function rollBall()");
    expect(html).toContain("scatter d6 dir ");
  });

  it("logs each challenge's dice and a plain result under the board", () => {
    expect(html).toContain('<p class="log" hidden>');
    expect(html).toContain("function challengeLog()");
    for (const result of [
      "successful ball-steal",
      "failed ball-steal",
      "successful tackle",
      "failed tackle",
    ]) {
      expect(html).toContain(result);
    }
  });

  it("offers the tackle only when the carrier is in budget", () => {
    const close = caseState(CASES[idx("close down the carrier — a hard tackle")]!);
    expect(reachTackle(close, "case-p0")).not.toBeNull();

    const far = caseState(CASES[idx("just out of reach — no tackle offered")]!);
    expect(reachTackle(far, "case-p0")).toBeNull();
  });

  it("plays each tackle case through to a terminal phase for its baked seed", () => {
    for (const title of [
      "close down the carrier — a hard tackle",
      "the carrier rides the challenge",
      "shoulder to shoulder — even attributes",
      "loose ball in a crowd — a tie spills it",
    ]) {
      const i = idx(title);
      const state = caseState(CASES[i]!);
      const seed = seedRng(`case-${i}`);
      const play = () => {
        let s = initMoveAction(state, seed);
        s = moveAction(s, { type: "selectPiece", pieceId: "case-p0" });
        s = moveAction(s, { type: "tackle" });
        let guard = 0;
        while (s.phase === "tackling" && guard++ < 20) {
          s = moveAction(s, { type: "advance" });
        }
        return s;
      };
      const a = play();
      const b = play();
      expect(a.outcome).toEqual(b.outcome);
      expect(["relocating", "foul", "looseBall"]).toContain(a.phase);
      expect(a.state.pieces.find((p) => p.id === "case-p0")!.movePoints).toBe(0);
      if (a.phase === "relocating") {
        expect(moveView(a).relocation).toEqual(relocationOptions(a.state, a.outcome!));
      }
    }
  });

  it("a tie in the crowd case scatters the ball to where looseBall says", () => {
    const i = idx("loose ball in a crowd — a tie spills it");
    const state = caseState(CASES[i]!);
    const seed = seedRng(`case-${i}`);
    let s = initMoveAction(state, seed);
    s = moveAction(s, { type: "selectPiece", pieceId: "case-p0" });
    s = moveAction(s, { type: "tackle" });
    let guard = 0;
    while (s.phase === "tackling" && guard++ < 20) s = moveAction(s, { type: "advance" });

    if (s.phase !== "looseBall") return; // the baked seed didn't tie — nothing to check
    const view = moveView(s);
    const direct = looseBall(
      s.outcome!.roll.rng,
      view.scatter!.at,
      s.state.pieces.map((p) => ({ id: p.id, at: p.at })),
    );
    expect(view.scatter!.route).toEqual(direct.route);
    expect(s.state.ball).toEqual(direct.rest);
  });
});
