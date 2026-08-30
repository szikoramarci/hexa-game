import { describe, expect, it } from "vitest";
import { cube, cubeEquals, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { rollDie, seedRng } from "../dice/dice.js";
import { reachableCubes } from "../movement/movement.js";
import {
  applyMove,
  ballCarrier,
  enteredInfluence,
  influencers,
  initMoveAction,
  moveAction,
  moveArrow,
  movePath,
  moveView,
  pathHazards,
  reachableForPiece,
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
