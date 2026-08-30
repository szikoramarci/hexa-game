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
  type MoveActionSnapshot,
  type MoveActionState,
} from "../move-action/move-action.js";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  writeMovementPlayground,
  type MovementCase,
  type MovementGroup,
  type ProbeEvent,
  type SeedChip,
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

/** One notable dice outcome a probe play can land in. */
type Outcome =
  | "safe"
  | "steal"
  | "tackle-won"
  | "tackle-lost"
  | "foul"
  | "lb-caught"
  | "lb-clear";

/** A case plus the seed chips it wants surfaced (resolved into `seeds` below). */
interface CaseDraft extends MovementCase {
  /** Event script a chip replays; also used to classify a seed's outcome. */
  probe?: readonly ProbeEvent[];
  /** One chip per entry — `outcome` may list several acceptable classes. */
  want?: readonly { label: string; outcome: Outcome | Outcome[] }[];
}

const SELECT_P0: ProbeEvent = { t: "selectPiece", pi: 0 };
const TACKLE: ProbeEvent = { t: "tackle" };
const TACKLE_WANT = [
  { label: "tackle won", outcome: "tackle-won" as const },
  { label: "tackle lost", outcome: "tackle-lost" as const },
  { label: "foul", outcome: "foul" as const },
  { label: "loose ball", outcome: ["lb-caught", "lb-clear"] as Outcome[] },
];

const DRAFTS: CaseDraft[] = [
  {
    title: "open field — a 2-hex step",
    group: "movement",
    play: { radius: 4, pieces: [{ at: origin, label: 1, movePoints: 2, team: HOME }] },
  },
  {
    title: "open field — the 4-hex move",
    group: "movement",
    play: { radius: 6, pieces: [{ at: origin, label: 1, movePoints: 4, team: HOME }] },
  },
  {
    title: "one pillar beside the piece",
    group: "movement",
    play: {
      radius: 5,
      pieces: [{ at: origin, label: 3, movePoints: 4, team: HOME }],
      obstacle: [cube(1, -1, 0)],
    },
  },
  {
    title: "walled off but for one gap",
    group: "movement",
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
    group: "movement",
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
    group: "movement",
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
    group: "steal",
    probe: [SELECT_P0, { t: "commit", hex: cubeKey(cube(3, 0, -3)) }],
    want: [
      { label: "safe run", outcome: "safe" },
      { label: "ball stolen", outcome: "steal" },
    ],
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
    group: "steal",
    probe: [SELECT_P0, { t: "commit", hex: cubeKey(cube(2, -1, -1)) }],
    want: [
      { label: "safe run", outcome: "safe" },
      { label: "ball stolen", outcome: "steal" },
    ],
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
    group: "tackle",
    probe: [SELECT_P0, TACKLE],
    want: TACKLE_WANT,
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
    group: "tackle",
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
    group: "tackle",
    probe: [SELECT_P0, TACKLE],
    want: [
      { label: "tackle lost", outcome: "tackle-lost" },
      { label: "foul", outcome: "foul" },
      { label: "loose ball", outcome: ["lb-caught", "lb-clear"] },
    ],
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
    group: "tackle",
    probe: [SELECT_P0, TACKLE],
    want: TACKLE_WANT,
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
    group: "loose-ball",
    probe: [SELECT_P0, TACKLE],
    want: [
      { label: "loose ball · caught", outcome: "lb-caught" },
      { label: "loose ball · rolls clear", outcome: "lb-clear" },
    ],
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

function keyToCube(k: string): Cube {
  const [x, y, z] = k.split(",").map(Number) as [number, number, number];
  return cube(x, y, z);
}

/** Run a case's probe under `seed`, then walk any pending move/tackle to a stop. */
function playProbe(
  state: MoveActionState,
  seed: number,
  probe: readonly ProbeEvent[],
): MoveActionSnapshot {
  let s = initMoveAction(state, seed);
  for (const e of probe) {
    if (e.t === "selectPiece") {
      s = moveAction(s, { type: "selectPiece", pieceId: `case-p${e.pi}` });
    } else if (e.t === "commit") {
      s = moveAction(s, { type: "commit", hex: keyToCube(e.hex) });
    } else {
      s = moveAction(s, { type: "tackle" });
    }
  }
  let guard = 0;
  while ((s.phase === "moving" || s.phase === "tackling") && guard++ < 60) {
    s = moveAction(s, { type: "advance" });
  }
  return s;
}

/** Bucket a terminal snapshot into one {@link Outcome}. */
function classify(s: MoveActionSnapshot): Outcome {
  if (s.phase === "stopped" && s.steal) return "steal";
  if (s.phase === "foul") return "foul";
  if (s.phase === "looseBall") return s.scatter?.caughtBy ? "lb-caught" : "lb-clear";
  if (s.outcome?.winner === "defender") return "tackle-won";
  if (s.outcome?.winner === "attacker") return "tackle-lost";
  return "safe";
}

const SEED_LIMIT = 4096;

/** The lowest seed in `[1, SEED_LIMIT)` that lands each wanted outcome. */
function resolveSeeds(c: CaseDraft): SeedChip[] {
  if (!c.probe || !c.want) return [];
  const state = caseState(c);
  return c.want.map((w) => {
    const accept = Array.isArray(w.outcome) ? w.outcome : [w.outcome];
    for (let seed = 1; seed < SEED_LIMIT; seed++) {
      if (accept.includes(classify(playProbe(state, seed, c.probe!)))) {
        return { label: w.label, seed };
      }
    }
    throw new Error(
      `outcome ${JSON.stringify(w.outcome)} not found for "${c.title}" in ${SEED_LIMIT} seeds`,
    );
  });
}

/** The authored cases with their seed chips resolved from the real reducer. */
const CASES: MovementCase[] = DRAFTS.map((c) => {
  const seeds = resolveSeeds(c);
  const { want: _want, probe, ...rest } = c;
  return seeds.length ? { ...rest, probe, seeds } : rest;
});

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
      expect(html).toContain(`<h3>${CASES[i]!.title}</h3>`);
    }
    expect(html).toContain('href="../../index.html"');
    expect(html).toContain('data-id="case-6-p1"');
    expect(html).toContain('class="ball"'); // a ball case is present
  });

  it("lays the cases out in titled sections with a jump nav", () => {
    for (const g of GROUP_ORDER) {
      expect(html).toContain(`id="group-${g}"`);
      expect(html).toContain(`<h2>${GROUP_LABEL[g]}</h2>`);
      expect(html).toContain(`href="#group-${g}"`);
    }
    // sections run in GROUP_ORDER
    const positions = GROUP_ORDER.map((g) => html.indexOf(`id="group-${g}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
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

  it("bakes seeds[0] for dice cases, seedRng(caseId) for the deterministic ones", () => {
    for (let i = 0; i < CASES.length; i++) {
      const expected = CASES[i]!.seeds?.[0]?.seed ?? seedRng(`case-${i}`);
      expect(html).toContain(`"seed":${expected}`);
    }
  });
});

/** Case index by title. */
const idx = (title: string) => CASES.findIndex((c) => c.title === title);

describe("movement playground page — seed chips", () => {
  const html = writeMovementPlayground("movement", "piece movement", "x", CASES);

  it("renders one chip per resolved outcome, plus a shuffle button", () => {
    expect(html).toContain('class="shuffle"');
    const diceCases = CASES.filter((c) => c.seeds?.length);
    expect(diceCases.length).toBeGreaterThan(0);
    for (const c of diceCases) {
      for (const chip of c.seeds!) {
        expect(html).toContain(`data-seed="${chip.seed}"`);
        expect(html).toContain(`>${chip.label}</button>`);
      }
    }
  });

  it("the deterministic movement cases carry no chips", () => {
    for (const c of CASES.filter((x) => x.group === "movement")) {
      expect(c.seeds).toBeUndefined();
    }
  });

  it("ships the chip wiring — restore/runProbe, shuffle, curSeed", () => {
    expect(html).toContain("function runProbe()");
    expect(html).toContain("function restore(seed)");
    expect(html).toContain("var curSeed");
    expect(html).toContain("querySelector('.shuffle')");
  });

  it("every baked chip seed reproduces its labelled outcome via the real reducer", () => {
    for (const c of DRAFTS) {
      if (!c.probe || !c.want) continue;
      const state = caseState(c);
      const seeds = resolveSeeds(c);
      seeds.forEach((chip, k) => {
        const want = c.want![k]!;
        const accept = Array.isArray(want.outcome) ? want.outcome : [want.outcome];
        expect(accept).toContain(classify(playProbe(state, chip.seed, c.probe!)));
      });
    }
  });

  it("the loose-ball case reaches a tie both ways within the seed budget", () => {
    const c = DRAFTS[idx("loose ball in a crowd — a tie spills it")]!;
    const labels = resolveSeeds(c).map((s) => s.label);
    expect(labels).toEqual(["loose ball · caught", "loose ball · rolls clear"]);
  });
});

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

  it("plays each tackle case to a terminal phase for every one of its chip seeds", () => {
    for (const title of [
      "close down the carrier — a hard tackle",
      "the carrier rides the challenge",
      "shoulder to shoulder — even attributes",
      "loose ball in a crowd — a tie spills it",
    ]) {
      const c = CASES[idx(title)]!;
      const state = caseState(c);
      for (const chip of c.seeds!) {
        const play = () => playProbe(state, chip.seed, c.probe!);
        const a = play();
        const b = play();
        expect(a.outcome).toEqual(b.outcome);
        expect(["relocating", "foul", "looseBall"]).toContain(a.phase);
        expect(a.state.pieces.find((p) => p.id === "case-p0")!.movePoints).toBe(0);
        if (a.phase === "relocating") {
          expect(moveView(a).relocation).toEqual(relocationOptions(a.state, a.outcome!));
        }
      }
    }
  });

  it("the loose-ball chip seeds scatter the ball to where looseBall says", () => {
    const c = CASES[idx("loose ball in a crowd — a tie spills it")]!;
    const state = caseState(c);
    for (const chip of c.seeds!) {
      const s = playProbe(state, chip.seed, c.probe!);
      expect(s.phase).toBe("looseBall");
      const view = moveView(s);
      const direct = looseBall(
        s.outcome!.roll.rng,
        view.scatter!.at,
        s.state.pieces.map((p) => ({ id: p.id, at: p.at })),
      );
      expect(view.scatter!.route).toEqual(direct.route);
      expect(s.state.ball).toEqual(direct.rest);
    }
  });
});
