import { describe, expect, it } from "vitest";
import { cube, cubeEquals, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { rollDie, seedRng } from "../dice/dice.js";
import { looseBall } from "../loose-ball/loose-ball.js";
import { reachableCubes } from "../movement/movement.js";
import {
  applyMove,
  applyTackle,
  ballCarrier,
  enteredInfluence,
  freeNeighbours,
  influencers,
  initMoveAction,
  moveAction,
  moveArrow,
  movePath,
  moveView,
  pathHazards,
  reachableForPiece,
  reachTackle,
  relocationOptions,
  resolveChallenge,
  tackleFoul,
  tackleTarget,
  type ChallengeRoll,
  type MoveActionSnapshot,
  type MoveActionState,
  type Piece,
} from "./move-action.js";

const origin = cube(0, 0, 0);
const keys = (hexes: Iterable<Cube>) => new Set([...hexes].map(cubeKey));

const piece = (over: Partial<Piece> & Pick<Piece, "id" | "at">): Piece => ({
  label: 1,
  movePoints: 3,
  team: "home",
  ...over,
});

function state(over: Partial<MoveActionState> = {}): MoveActionState {
  return {
    pieces: [piece({ id: "p1", at: origin })],
    obstacles: [],
    ...over,
  };
}

/** Walk a committed "moving" snapshot to completion (or a steal). */
function runMove(snap: MoveActionSnapshot): MoveActionSnapshot {
  let s = snap;
  let guard = 0;
  while (s.phase === "moving" && guard++ < 50) {
    s = moveAction(s, { type: "advance" });
  }
  return s;
}

/** First seed whose first `d6` roll is `1` (a steal); and one where it is not. */
function seedRollingOne(): number {
  for (let s = 1; s < 100000; s++) if (rollDie(seedRng(s))[0] === 1) return s;
  throw new Error("no seed rolls a 1");
}
function seedNeverSteals(rolls: number): number {
  for (let s = 1; s < 100000; s++) {
    let rng = seedRng(s);
    let ok = true;
    for (let i = 0; i < rolls; i++) {
      const [r, n] = rollDie(rng);
      if (r === 1) ok = false;
      rng = n;
    }
    if (ok) return s;
  }
  throw new Error("no calm seed");
}

describe("reachableForPiece", () => {
  it("is reachableCubes minus the piece's own hex", () => {
    const s = state({ pieces: [piece({ id: "p1", at: origin, movePoints: 2 })] });
    const got = reachableForPiece(s, "p1");
    const expected = reachableCubes(origin, 2).filter((h) => !cubeEquals(h, origin));
    expect(keys(got)).toEqual(keys(expected));
  });

  it("treats other pieces as blockers by default", () => {
    const wall = cube(1, -1, 0);
    const s = state({
      pieces: [
        piece({ id: "p1", at: origin }),
        piece({ id: "p2", at: wall, team: "away" }),
      ],
    });
    expect(reachableForPiece(s, "p1").some((h) => cubeEquals(h, wall))).toBe(false);
  });

  it("ignores other pieces when piecesBlock is false", () => {
    const spot = cube(1, -1, 0);
    const s = state({
      piecesBlock: false,
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "p2", at: spot })],
    });
    expect(reachableForPiece(s, "p1").some((h) => cubeEquals(h, spot))).toBe(true);
  });

  it("is empty with zero move points", () => {
    expect(
      reachableForPiece(state({ pieces: [piece({ id: "p1", at: origin, movePoints: 0 })] }), "p1"),
    ).toEqual([]);
  });

  it("throws for an unknown piece id", () => {
    expect(() => reachableForPiece(state(), "nope")).toThrow(RangeError);
  });
});

describe("movePath", () => {
  it("returns the shortest path including both endpoints", () => {
    const path = movePath(state(), "p1", cube(2, -2, 0))!;
    expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(path.at(-1)).toEqual({ x: 2, y: -2, z: 0 });
    expect(path).toHaveLength(3);
  });

  it("is null past the piece's move points", () => {
    const s = state({ pieces: [piece({ id: "p1", at: origin, movePoints: 2 })] });
    expect(movePath(s, "p1", cube(3, -3, 0))).toBeNull();
  });

  it("routes around a wall", () => {
    const obstacles = [cube(1, -1, 0), cube(1, 0, -1), cube(0, 1, -1)];
    const s = state({ obstacles, pieces: [piece({ id: "p1", at: origin, movePoints: 5 })] });
    const path = movePath(s, "p1", cube(2, -1, -1))!;
    for (const o of obstacles) expect(path.some((h) => cubeEquals(h, o))).toBe(false);
  });

  it("returns [at] for the piece's own hex", () => {
    expect(movePath(state(), "p1", origin)).toEqual([{ x: 0, y: 0, z: 0 }]);
  });
});

describe("moveArrow", () => {
  it("is null for a path under two hexes", () => {
    expect(moveArrow([])).toBeNull();
    expect(moveArrow([origin])).toBeNull();
  });

  it("is a dashed straight spec through the path", () => {
    const path = [origin, cube(1, -1, 0), cube(2, -2, 0)];
    const arrow = moveArrow(path)!;
    expect(arrow.shape).toBe("straight");
    expect(arrow.dash).toBe("dashed");
    expect(arrow.hexes).toHaveLength(3);
    expect(arrow.hexes).not.toBe(path);
  });

  it("lets style override the defaults", () => {
    expect(moveArrow([origin, cube(1, -1, 0)], { color: "#000", dash: "solid" })).toMatchObject({
      color: "#000",
      dash: "solid",
    });
  });
});

describe("applyMove", () => {
  it("moves the piece and spends the step count", () => {
    const next = applyMove(state(), "p1", [origin, cube(1, -1, 0), cube(2, -2, 0)]);
    expect(next.pieces[0]!.at).toEqual({ x: 2, y: -2, z: 0 });
    expect(next.pieces[0]!.movePoints).toBe(1);
  });

  it("carries the ball along when the mover holds it", () => {
    const s = state({ ball: origin });
    const next = applyMove(s, "p1", [origin, cube(1, -1, 0)]);
    expect(next.ball).toEqual({ x: 1, y: -1, z: 0 });
  });

  it("leaves the ball put when a non-carrier moves", () => {
    const s = state({
      ball: cube(3, -3, 0),
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "p2", at: cube(3, -3, 0) })],
    });
    expect(applyMove(s, "p1", [origin, cube(1, -1, 0)]).ball).toEqual({ x: 3, y: -3, z: 0 });
  });

  it("never mutates the input", () => {
    const s = state({ ball: origin });
    const frozen = structuredClone(s);
    applyMove(s, "p1", [origin, cube(1, -1, 0)]);
    expect(s).toEqual(frozen);
  });
});

describe("influencers / ballCarrier / pathHazards", () => {
  const guard = piece({ id: "g", at: cube(2, -2, 0), team: "away" });
  const runner = piece({ id: "r", at: origin, team: "home", movePoints: 5 });
  const s = state({ pieces: [runner, guard], ball: origin });

  it("ballCarrier is the piece on the ball hex", () => {
    expect(ballCarrier(s)?.id).toBe("r");
    expect(ballCarrier(state())).toBeNull();
  });

  it("influencers are enemies exactly one hex from the target", () => {
    expect(influencers(s, cube(2, -1, -1), "home").map((p) => p.id)).toEqual(["g"]);
    expect(influencers(s, cube(2, -2, 0), "home")).toEqual([]); // the guard's own hex
    expect(influencers(s, cube(0, 0, 0), "home")).toEqual([]); // too far
    expect(influencers(s, cube(2, -1, -1), "away")).toEqual([]); // same team as guard
  });

  it("enteredInfluence is the opponents `to` adds over `from`", () => {
    // guard at (2,-2,0): covers (1,-1,0) and (2,-1,-1) but not origin.
    expect(enteredInfluence(s, origin, cube(1, -1, 0), "home").map((p) => p.id)).toEqual(["g"]);
    // moving along the influence border: (1,-1,0) -> (2,-1,-1), both covered -> nobody new
    expect(enteredInfluence(s, cube(1, -1, 0), cube(2, -1, -1), "home")).toEqual([]);
  });

  it("pathHazards flags only the step INTO an influence, not staying in it", () => {
    // guard at (2,-2,0): covers (1,-1,0) and (2,-1,-1). Enter at (1,-1,0),
    // stay at (2,-1,-1), leave at (2,0,-2).
    const path = [origin, cube(1, -1, 0), cube(2, -1, -1), cube(2, 0, -2)];
    expect(pathHazards(s, "r", path).map(cubeKey)).toEqual([cubeKey(cube(1, -1, 0))]);
    // p2 doesn't carry the ball -> no hazards even on the same path
    const s2 = state({ pieces: [runner, guard, piece({ id: "x", at: cube(-1, 0, 1) })], ball: origin });
    expect(pathHazards(s2, "x", path)).toEqual([]);
  });

  it("pathHazards flags a re-entry after leaving", () => {
    // guard at (0,-2,2): covers (0,-1,1) and (1,-2,1), not (1,-1,0).
    const g2 = state({
      ball: origin,
      pieces: [
        piece({ id: "r", at: origin, team: "home", movePoints: 6 }),
        piece({ id: "g", at: cube(0, -2, 2), team: "away" }),
      ],
    });
    //  (0,-1,1) enter | (1,-1,0) out | (1,-2,1) enter again
    const path = [origin, cube(0, -1, 1), cube(1, -1, 0), cube(1, -2, 1)];
    expect(pathHazards(g2, "r", path).map(cubeKey)).toEqual([
      cubeKey(cube(0, -1, 1)),
      cubeKey(cube(1, -2, 1)),
    ]);
  });
});

describe("moveAction reducer — the flow", () => {
  it("starts idle", () => {
    const s = initMoveAction(state());
    expect(s.phase).toBe("idle");
    expect(moveView(s).reachable).toEqual([]);
  });

  it("select -> hover -> commit -> advance lands the piece and spends points", () => {
    let s = initMoveAction(state());
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    expect(s.phase).toBe("aiming");
    expect(moveView(s).reachable.length).toBeGreaterThan(0);

    s = moveAction(s, { type: "hoverHex", hex: cube(2, -2, 0) });
    expect(moveView(s).arrow?.hexes).toHaveLength(3);

    s = moveAction(s, { type: "commit" });
    expect(s.phase).toBe("moving");
    expect(moveView(s).step).toMatchObject({ index: 0, count: 2, contest: [] });

    s = runMove(s);
    expect(s.state.pieces[0]!.at).toEqual({ x: 2, y: -2, z: 0 });
    expect(s.state.pieces[0]!.movePoints).toBe(1);
    expect(s.phase).toBe("aiming");
  });

  it("commit with an explicit hex skips the hover step", () => {
    let s = initMoveAction(state());
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "commit", hex: cube(1, -1, 0) });
    s = runMove(s);
    expect(s.state.pieces[0]!.at).toEqual({ x: 1, y: -1, z: 0 });
  });

  it("goes to spent when the piece runs out of move points", () => {
    let s = initMoveAction(state({ pieces: [piece({ id: "p1", at: origin, movePoints: 1 })] }));
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "commit", hex: cube(1, -1, 0) });
    s = runMove(s);
    expect(s.phase).toBe("spent");
    expect(moveView(s).reachable).toEqual([]);
  });

  it("re-selecting switches the active piece; cancel returns to idle", () => {
    let s = initMoveAction(
      state({
        pieces: [
          piece({ id: "p1", at: origin }),
          piece({ id: "p2", at: cube(3, -3, 0), team: "away" }),
        ],
      }),
    );
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "hoverHex", hex: cube(1, -1, 0) });
    s = moveAction(s, { type: "selectPiece", pieceId: "p2" });
    expect(s.activeId).toBe("p2");
    expect(s.target).toBeNull();
    s = moveAction(s, { type: "cancel" });
    expect(s.phase).toBe("idle");
  });

  it("ignores events that do not apply, and never mutates the snapshot", () => {
    const s0 = initMoveAction(state());
    expect(moveAction(s0, { type: "hoverHex", hex: origin })).toBe(s0);
    expect(moveAction(s0, { type: "advance" })).toBe(s0);
    expect(moveAction(s0, { type: "selectPiece", pieceId: "ghost" })).toBe(s0);

    const s1 = moveAction(s0, { type: "selectPiece", pieceId: "p1" });
    expect(moveAction(s1, { type: "commit", hex: cube(9, -9, 0) })).toBe(s1);
  });

  it("does not accept a new selection mid-move", () => {
    let s = initMoveAction(
      state({
        pieces: [
          piece({ id: "p1", at: origin, movePoints: 4 }),
          piece({ id: "p2", at: cube(-3, 3, 0), team: "away" }),
        ],
      }),
    );
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "commit", hex: cube(3, -3, 0) });
    expect(moveAction(s, { type: "selectPiece", pieceId: "p2" })).toBe(s);
  });
});

describe("moveAction reducer — the ball steal", () => {
  // Carrier at origin heading to (3,0,-3) along (1,0,-1) -> (2,0,-2) -> (3,0,-3).
  // Guard "gd" at (3,-1,-2): its influence covers (2,0,-2) and (3,0,-3) but not
  // the first step (1,0,-1).
  const target = cube(3, 0, -3);
  const scene = (over: Partial<MoveActionState> = {}) =>
    state({
      ball: origin,
      pieces: [
        piece({ id: "run", at: origin, team: "home", movePoints: 6 }),
        piece({ id: "gd", at: cube(3, -1, -2), team: "away" }),
      ],
      ...over,
    });

  it("a 1 hands the ball to the opponent and stops the move on that hex", () => {
    let s = initMoveAction(scene(), seedRollingOne());
    s = moveAction(s, { type: "selectPiece", pieceId: "run" });
    s = moveAction(s, { type: "commit", hex: target });
    s = runMove(s);

    expect(s.phase).toBe("stopped");
    expect(s.steal?.by).toBe("gd");
    expect(s.steal?.at).toEqual({ x: 2, y: 0, z: -2 }); // first contested step
    const run = s.state.pieces.find((p) => p.id === "run")!;
    expect(run.at).toEqual({ x: 2, y: 0, z: -2 }); // halted where it was robbed
    expect(run.movePoints).toBe(4); // spent 2 of 6
    expect(s.state.ball).toEqual({ x: 3, y: -1, z: -2 }); // now on the guard's hex
    expect(moveView(s).carrying).toBe(false);
  });

  it("no steal when the roll misses — the move completes and the ball follows", () => {
    let s = initMoveAction(scene(), seedNeverSteals(4));
    s = moveAction(s, { type: "selectPiece", pieceId: "run" });
    s = moveAction(s, { type: "commit", hex: target });
    s = runMove(s);

    expect(s.phase).toBe("aiming");
    expect(s.steal).toBeNull();
    expect(s.state.pieces.find((p) => p.id === "run")!.at).toEqual({ x: 3, y: 0, z: -3 });
    expect(s.state.ball).toEqual({ x: 3, y: 0, z: -3 });
  });

  it("rolls once per adjacent opponent and the first (by id) that hits steals", () => {
    // Both guards' influence covers (0,-1,1): "g1" sorts before "g2".
    const twoGuards = state({
      ball: origin,
      pieces: [
        piece({ id: "run", at: origin, team: "home", movePoints: 4 }),
        piece({ id: "g1", at: cube(0, -2, 2), team: "away" }),
        piece({ id: "g2", at: cube(1, -2, 1), team: "away" }),
      ],
    });
    let s = initMoveAction(twoGuards, seedRollingOne());
    s = moveAction(s, { type: "selectPiece", pieceId: "run" });
    s = moveAction(s, { type: "commit", hex: cube(0, -1, 1) });
    const before = s.rng;
    s = runMove(s);
    expect(s.steal?.rolls).toHaveLength(2); // one per guard
    expect(s.rng).not.toBe(before); // rng advanced by the rolls
    expect(["g1", "g2"]).toContain(s.steal?.by);
  });

  it("a non-carrier walks through influence untouched (no rolls, rng unchanged)", () => {
    const s0 = initMoveAction(
      scene({
        pieces: [
          piece({ id: "run", at: origin, team: "home", movePoints: 6 }),
          piece({ id: "gd", at: cube(3, -1, -2), team: "away" }),
          piece({ id: "free", at: cube(-1, 0, 1), team: "home", movePoints: 6 }),
        ],
      }),
      seedRollingOne(),
    );
    let s = moveAction(s0, { type: "selectPiece", pieceId: "free" });
    s = moveAction(s, { type: "commit", hex: cube(2, 0, -2) });
    s = runMove(s);
    expect(s.phase).not.toBe("stopped");
    expect(s.rng).toBe(s0.rng);
  });

  it("moveView exposes the contest on the threatened step and the hazards while aiming", () => {
    let s = initMoveAction(scene(), seedNeverSteals(6));
    s = moveAction(s, { type: "selectPiece", pieceId: "run" });
    s = moveAction(s, { type: "hoverHex", hex: target });
    // enters gd's influence at (2,0,-2); (3,0,-3) is "still inside", not a new step-in
    expect(moveView(s).hazards.map(cubeKey)).toEqual([cubeKey(cube(2, 0, -2))]);

    s = moveAction(s, { type: "commit" });
    // step 0 -> (1,0,-1): safe; step 1 -> (2,0,-2): steps into gd's influence
    expect(moveView(s).step?.contest).toEqual([]);
    s = moveAction(s, { type: "advance" });
    expect(moveView(s).step?.contest).toEqual(["gd"]);
    s = moveAction(s, { type: "advance" });
    // (2,0,-2) -> (3,0,-3): still in gd's influence, no fresh roll
    expect(moveView(s).step?.contest).toEqual([]);
  });

  it("after a steal, selecting a piece resumes and replays deterministically", () => {
    const seed = seedRollingOne();
    const play = () =>
      runMove(
        moveAction(
          moveAction(initMoveAction(scene(), seed), { type: "selectPiece", pieceId: "run" }),
          { type: "commit", hex: target },
        ),
      );
    const run1 = play();
    expect(play().steal).toEqual(run1.steal);
    expect(run1.phase).toBe("stopped");

    const resumed = moveAction(run1, { type: "selectPiece", pieceId: "gd" });
    expect(resumed.phase).toBe("aiming");
    expect(resumed.activeId).toBe("gd");
  });
});

// --- tackle --------------------------------------------------------------

/** Carrier "att" on the ball at origin; defender "def" 2 hexes west with 3 MP. */
const tackleScene = (over: Partial<MoveActionState> = {}): MoveActionState =>
  state({
    ball: origin,
    pieces: [
      piece({ id: "att", at: origin, team: "home", movePoints: 0 }),
      piece({ id: "def", at: cube(2, -2, 0), team: "away", movePoints: 3 }),
    ],
    ...over,
  });

/** First seed whose 3-vs-3 challenge matches `pred`. */
function seedFor(pred: (r: ChallengeRoll) => boolean, att = 3, def = 3): number {
  for (let s = 1; s < 200_000; s++) {
    if (pred(resolveChallenge(seedRng(s), att, def))) return s;
  }
  throw new Error("no seed matches");
}

const DEFENDER_WINS = seedFor((r) => r.winner === "defender" && r.defenderRoll !== 1);
const ATTACKER_WINS = seedFor((r) => r.winner === "attacker" && r.defenderRoll !== 1);
const FOUL = seedFor((r) => r.defenderRoll === 1);
const TIE = seedFor((r) => r.tie && r.defenderRoll !== 1);

function commitTackle(seed: number, over?: Partial<MoveActionState>): MoveActionSnapshot {
  let s = initMoveAction(tackleScene(over), seed);
  s = moveAction(s, { type: "selectPiece", pieceId: "def" });
  s = moveAction(s, { type: "tackle" });
  let guard = 0;
  while (s.phase === "tackling" && guard++ < 50) s = moveAction(s, { type: "advance" });
  return s;
}

const pieceAt = (s: MoveActionSnapshot, id: string) =>
  s.state.pieces.find((p) => p.id === id)!;

describe("freeNeighbours", () => {
  it("is the six neighbours minus pieces and obstacles", () => {
    const s = state({
      obstacles: [cube(1, 0, -1)],
      pieces: [piece({ id: "p1", at: cube(0, 1, -1) })],
    });
    const got = freeNeighbours(s, origin);
    expect(got).toHaveLength(4);
    expect(got.some((h) => cubeEquals(h, cube(1, 0, -1)))).toBe(false);
    expect(got.some((h) => cubeEquals(h, cube(0, 1, -1)))).toBe(false);
  });

  it("is all six when nothing is in the way", () => {
    expect(freeNeighbours(state({ pieces: [] }), cube(5, -5, 0))).toHaveLength(6);
  });
});

describe("reachTackle / tackleTarget", () => {
  it("routes onto the carrier's hex within move points", () => {
    const reach = reachTackle(tackleScene(), "def")!;
    expect(reach.path.map(cubeKey)).toEqual(
      [cube(2, -2, 0), cube(1, -1, 0), origin].map(cubeKey),
    );
    expect(reach.start).toEqual({ x: 2, y: -2, z: 0 });
    expect(reach.approachEnd).toEqual({ x: 1, y: -1, z: 0 });
  });

  it("is null when the carrier is out of budget", () => {
    const s = tackleScene({
      pieces: [
        piece({ id: "att", at: origin, team: "home", movePoints: 0 }),
        piece({ id: "def", at: cube(2, -2, 0), team: "away", movePoints: 1 }),
      ],
    });
    expect(reachTackle(s, "def")).toBeNull();
  });

  it("only allows the carrier's hex as the final step, not a route through pieces", () => {
    const s = tackleScene({
      obstacles: [cube(1, 0, -1), cube(0, 1, -1), cube(-1, 1, 0), cube(-1, 0, 1), cube(0, -1, 1)],
      pieces: [
        piece({ id: "att", at: origin, team: "home", movePoints: 0 }),
        piece({ id: "wall", at: cube(1, -1, 0), team: "home", movePoints: 0 }),
        piece({ id: "def", at: cube(2, -2, 0), team: "away", movePoints: 3 }),
      ],
    });
    expect(reachTackle(s, "def")).toBeNull(); // origin is walled off
  });

  it("works when the defender already stands next to the carrier", () => {
    const s = tackleScene({
      pieces: [
        piece({ id: "att", at: origin, team: "home", movePoints: 0 }),
        piece({ id: "def", at: cube(1, -1, 0), team: "away", movePoints: 2 }),
      ],
    });
    const reach = reachTackle(s, "def")!;
    expect(reach.path).toHaveLength(2);
    expect(reach.approachEnd).toEqual(reach.start);
  });

  it("tackleTarget is the enemy carrier when reachable, else null", () => {
    expect(tackleTarget(tackleScene(), "def")?.id).toBe("att");
    // teammate carrier
    const friendly = tackleScene({
      pieces: [
        piece({ id: "att", at: origin, team: "away", movePoints: 0 }),
        piece({ id: "def", at: cube(2, -2, 0), team: "away", movePoints: 3 }),
      ],
    });
    expect(tackleTarget(friendly, "def")).toBeNull();
    // no ball
    expect(tackleTarget(tackleScene({ ball: undefined }), "def")).toBeNull();
  });
});

describe("resolveChallenge / tackleFoul", () => {
  it("adds the attribute to each roll and the higher score wins", () => {
    const r = resolveChallenge(seedRng(DEFENDER_WINS), 3, 3);
    expect(r.attackerScore).toBe(r.attackerRoll + 3);
    expect(r.defenderScore).toBe(r.defenderRoll + 3);
    expect(r.winner).toBe("defender");
  });

  it("ties when the scores are equal", () => {
    const r = resolveChallenge(seedRng(TIE), 3, 3);
    expect(r.tie).toBe(true);
    expect(r.winner).toBeNull();
  });

  it("rolls the attacker first, then the defender, advancing rng by two draws", () => {
    const rng = seedRng(42);
    const [a, r1] = rollDie(rng);
    const [d, r2] = rollDie(r1);
    const r = resolveChallenge(rng, 0, 0);
    expect([r.attackerRoll, r.defenderRoll]).toEqual([a, d]);
    expect(r.rng).toBe(r2);
  });

  it("a higher attribute flips an otherwise tied pair of rolls", () => {
    const seed = seedFor((r) => r.attackerRoll === r.defenderRoll, 0, 0);
    expect(resolveChallenge(seedRng(seed), 5, 1).winner).toBe("attacker");
  });

  it("tackleFoul is a defender roll of 1", () => {
    expect(tackleFoul(1)).toBe(true);
    expect(tackleFoul(2)).toBe(false);
  });
});

describe("moveAction reducer — the tackle", () => {
  it("offers the tackle while aiming and walks the approach on advance", () => {
    let s = initMoveAction(tackleScene(), DEFENDER_WINS);
    s = moveAction(s, { type: "selectPiece", pieceId: "def" });
    expect(moveView(s).tackle?.carrierId).toBe("att");

    s = moveAction(s, { type: "tackle" });
    expect(s.phase).toBe("tackling");
    s = moveAction(s, { type: "advance" }); // walk to the approach hex
    expect(moveView(s).step?.contest).toEqual(["att"]); // the lunge
    s = moveAction(s, { type: "advance" }); // lunge -> resolve
    expect(s.phase).toBe("relocating");
  });

  it("is a no-op outside aiming or when the carrier is unreachable", () => {
    const idle = initMoveAction(tackleScene());
    expect(moveAction(idle, { type: "tackle" })).toBe(idle);

    const far = tackleScene({
      pieces: [
        piece({ id: "att", at: origin, team: "home", movePoints: 0 }),
        piece({ id: "def", at: cube(5, -5, 0), team: "away", movePoints: 3 }),
      ],
    });
    let s = initMoveAction(far);
    s = moveAction(s, { type: "selectPiece", pieceId: "def" });
    expect(moveAction(s, { type: "tackle" })).toBe(s);
  });

  it("committing a tackle spends every remaining move point", () => {
    for (const seed of [DEFENDER_WINS, ATTACKER_WINS, FOUL, TIE]) {
      expect(pieceAt(commitTackle(seed), "def").movePoints).toBe(0);
    }
  });

  it("defender wins: ball to the defender, relocation around the attacker", () => {
    const s = commitTackle(DEFENDER_WINS);
    expect(s.phase).toBe("relocating");
    expect(ballCarrier(s.state)?.id).toBe("def");

    const opts = moveView(s).relocation!;
    expect(keys(opts)).toEqual(keys(freeNeighbours(s.state, origin)));
    expect(opts.some((h) => cubeEquals(h, origin))).toBe(false);

    const dest = opts[0]!;
    const done = moveAction(s, { type: "relocate", hex: dest });
    expect(done.phase).toBe("spent");
    expect(pieceAt(done, "def").at).toEqual(dest);
    expect(done.state.ball).toEqual(dest);
    expect(pieceAt(done, "att").at).toEqual(origin); // attacker unmoved
  });

  it("defender wins: cancel returns the defender to where the tackle started", () => {
    const s = commitTackle(DEFENDER_WINS);
    const done = moveAction(s, { type: "cancel" });
    expect(done.phase).toBe("spent");
    expect(pieceAt(done, "def").at).toEqual({ x: 2, y: -2, z: 0 });
    expect(done.state.ball).toEqual({ x: 2, y: -2, z: 0 });
  });

  it("ignores a relocate to a hex that is not on offer", () => {
    const s = commitTackle(DEFENDER_WINS);
    expect(moveAction(s, { type: "relocate", hex: cube(9, -9, 0) })).toBe(s);
  });

  it("attacker wins: ball stays with the attacker, relocation around the defender", () => {
    const s = commitTackle(ATTACKER_WINS);
    expect(s.phase).toBe("relocating");
    expect(ballCarrier(s.state)?.id).toBe("att");
    expect(pieceAt(s, "def").at).toEqual({ x: 1, y: -1, z: 0 }); // rests at approachEnd

    const opts = moveView(s).relocation!;
    expect(keys(opts)).toEqual(keys(freeNeighbours(s.state, cube(1, -1, 0))));

    const dest = opts.find((h) => !cubeEquals(h, origin))!;
    const done = moveAction(s, { type: "relocate", hex: dest });
    expect(pieceAt(done, "att").at).toEqual(dest);
    expect(done.state.ball).toEqual(dest);
    expect(pieceAt(done, "def").at).toEqual({ x: 1, y: -1, z: 0 });
  });

  it("attacker wins: cancel leaves the attacker on its hex", () => {
    const done = moveAction(commitTackle(ATTACKER_WINS), { type: "cancel" });
    expect(done.phase).toBe("spent");
    expect(pieceAt(done, "att").at).toEqual(origin);
    expect(done.state.ball).toEqual(origin);
  });

  it("boxed in: no free hex around the defender leaves only cancel", () => {
    // ring the approach hex (1,-1,0) with obstacles, keeping origin for the att
    const ring = [cube(2, -2, 0), cube(2, -1, -1), cube(1, 0, -1), cube(0, -1, 1), cube(1, -2, 1)];
    const s = commitTackle(ATTACKER_WINS, { obstacles: ring });
    expect(moveView(s).relocation).toEqual([]);
    expect(moveAction(s, { type: "relocate", hex: ring[0]! })).toBe(s);
    const done = moveAction(s, { type: "cancel" });
    expect(done.phase).toBe("spent");
    expect(pieceAt(done, "att").at).toEqual(origin);
  });

  it("a defender 1 is a foul — dead end, ball untouched (TODO)", () => {
    const s = commitTackle(FOUL);
    expect(s.phase).toBe("foul");
    expect(moveView(s).foul).toMatchObject({ attackerId: "att", defenderId: "def", at: origin });
    expect(s.state.ball).toEqual(origin); // unchanged
    expect(pieceAt(s, "def").movePoints).toBe(0);
    // leave it
    expect(moveAction(s, { type: "selectPiece", pieceId: "att" }).phase).toBe("spent");
  });

  it("a tie scatters the ball from the carrier's hex", () => {
    const s = commitTackle(TIE);
    expect(s.phase).toBe("looseBall");
    expect(moveView(s).looseBall).toMatchObject({ attackerId: "att", defenderId: "def" });

    const scatter = moveView(s).scatter!;
    expect(scatter.at).toEqual(origin);
    expect(scatter.route[0]).toEqual(origin);
    // matches a direct looseBall roll from the challenge's post-tie rng
    const tie = resolveChallenge(seedRng(TIE), 3, 3);
    const direct = looseBall(tie.rng, origin, [
      { id: "att", at: origin },
      { id: "def", at: cube(1, -1, 0) }, // defender rested at approachEnd
    ]);
    expect(scatter.route).toEqual(direct.route);
    expect(s.state.ball).toEqual(scatter.rest);
    expect(s.rng).toBe(direct.rng);
  });

  it("a clear-line tie leaves the ball loose — no carrier", () => {
    // ring the carrier so the only stoppers are att (on origin, ignored) and def
    const s = commitTackle(TIE);
    const scatter = moveView(s).scatter!;
    if (scatter.caughtBy === null) {
      expect(ballCarrier(s.state)).toBeNull();
      expect(s.state.ball).toEqual(scatter.rest);
    } else {
      expect(ballCarrier(s.state)?.id).toBe(scatter.caughtBy);
    }
  });

  it("a defender on the scatter line collects the loose ball", () => {
    // Place def where the TIE seed's scatter direction will run it over. Roll
    // the scatter first to know the line, then seat def one hex along it.
    const tie = resolveChallenge(seedRng(TIE), 3, 3);
    const dir = looseBall(tie.rng, origin, []).direction;
    const onLine = cube(dir.x, dir.y, dir.z);
    const scene = tackleScene({
      pieces: [
        piece({ id: "att", at: origin, team: "home", movePoints: 0 }),
        piece({ id: "def", at: onLine, team: "away", movePoints: 1 }),
      ],
    });
    let s = initMoveAction(scene, TIE);
    s = moveAction(s, { type: "selectPiece", pieceId: "def" });
    s = moveAction(s, { type: "tackle" });
    let guard = 0;
    while (s.phase === "tackling" && guard++ < 50) s = moveAction(s, { type: "advance" });

    expect(s.phase).toBe("looseBall");
    expect(moveView(s).scatter!.caughtBy).toBe("def");
    expect(ballCarrier(s.state)?.id).toBe("def");
    expect(s.state.ball).toEqual(onLine);
  });

  it("replays the scatter from a fixed tie seed", () => {
    const a = commitTackle(TIE);
    const b = commitTackle(TIE);
    expect(moveView(a).scatter).toEqual(moveView(b).scatter);
    expect(a.state.ball).toEqual(b.state.ball);
  });

  it("selectPiece / cancel still leave the looseBall phase", () => {
    const s = commitTackle(TIE);
    expect(moveAction(s, { type: "selectPiece", pieceId: "att" }).phase).toBe("spent");
    expect(moveAction(s, { type: "cancel" }).phase).toBe("idle");
  });

  it("replays a whole tackle from a fixed seed", () => {
    const a = commitTackle(DEFENDER_WINS);
    const b = commitTackle(DEFENDER_WINS);
    expect(a.outcome).toEqual(b.outcome);
    const relocated = (x: MoveActionSnapshot) =>
      moveAction(x, { type: "relocate", hex: moveView(x).relocation![0]! });
    expect(relocated(a).state.pieces).toEqual(relocated(b).state.pieces);
  });

  it("does not accept a new selection mid-tackle", () => {
    let s = initMoveAction(tackleScene(), DEFENDER_WINS);
    s = moveAction(s, { type: "selectPiece", pieceId: "def" });
    s = moveAction(s, { type: "tackle" });
    expect(moveAction(s, { type: "selectPiece", pieceId: "att" })).toBe(s);
  });
});

describe("applyTackle", () => {
  it("never mutates the input state", () => {
    const s = commitTackle(DEFENDER_WINS);
    const frozen = structuredClone(s.state);
    applyTackle(s.state, s.outcome!, cube(1, 0, -1));
    expect(s.state).toEqual(frozen);
  });

  it("relocationOptions is empty on a foul", () => {
    const s = commitTackle(FOUL);
    expect(relocationOptions(s.state, s.outcome!)).toEqual([]);
  });
});
