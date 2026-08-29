import { describe, expect, it } from "vitest";
import { cube, cubeEquals, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { reachableCubes } from "../movement/movement.js";
import {
  applyMove,
  initMoveAction,
  moveAction,
  moveArrow,
  movePath,
  moveView,
  reachableForPiece,
  type MoveActionSnapshot,
  type MoveActionState,
  type Piece,
} from "./move-action.js";

const origin = cube(0, 0, 0);
const keys = (hexes: Iterable<Cube>) => new Set([...hexes].map(cubeKey));

function state(over: Partial<MoveActionState> = {}): MoveActionState {
  return {
    pieces: [{ id: "p1", label: 1, at: origin, movePoints: 3 }],
    obstacles: [],
    ...over,
  };
}

/** Walk a committed "moving" snapshot to completion. */
function runMove(snap: MoveActionSnapshot): MoveActionSnapshot {
  let s = snap;
  let guard = 0;
  while (s.phase === "moving" && guard++ < 50) {
    s = moveAction(s, { type: "advance" });
  }
  return s;
}

describe("reachableForPiece", () => {
  it("is reachableCubes minus the piece's own hex", () => {
    const s = state({ pieces: [{ id: "p1", label: 1, at: origin, movePoints: 2 }] });
    const got = reachableForPiece(s, "p1");
    const expected = reachableCubes(origin, 2).filter((h) => !cubeEquals(h, origin));
    expect(keys(got)).toEqual(keys(expected));
    expect(got.some((h) => cubeEquals(h, origin))).toBe(false);
  });

  it("treats other pieces as blockers by default", () => {
    const wall = cube(1, -1, 0);
    const s = state({
      pieces: [
        { id: "p1", label: 1, at: origin, movePoints: 3 },
        { id: "p2", label: 2, at: wall, movePoints: 3 },
      ],
    });
    expect(reachableForPiece(s, "p1").some((h) => cubeEquals(h, wall))).toBe(false);
  });

  it("ignores other pieces when piecesBlock is false", () => {
    const spot = cube(1, -1, 0);
    const s = state({
      piecesBlock: false,
      pieces: [
        { id: "p1", label: 1, at: origin, movePoints: 3 },
        { id: "p2", label: 2, at: spot, movePoints: 3 },
      ],
    });
    expect(reachableForPiece(s, "p1").some((h) => cubeEquals(h, spot))).toBe(true);
  });

  it("is empty with zero move points", () => {
    expect(reachableForPiece(state({ pieces: [{ id: "p1", label: 1, at: origin, movePoints: 0 }] }), "p1")).toEqual([]);
  });

  it("throws for an unknown piece id", () => {
    expect(() => reachableForPiece(state(), "nope")).toThrow(RangeError);
  });
});

describe("movePath", () => {
  it("returns the shortest path including both endpoints", () => {
    const target = cube(2, -2, 0);
    const path = movePath(state(), "p1", target)!;
    expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(path.at(-1)).toEqual({ x: 2, y: -2, z: 0 });
    expect(path).toHaveLength(3);
  });

  it("is null past the piece's move points", () => {
    const s = state({ pieces: [{ id: "p1", label: 1, at: origin, movePoints: 2 }] });
    expect(movePath(s, "p1", cube(3, -3, 0))).toBeNull();
  });

  it("routes around a wall", () => {
    const obstacles = [cube(1, -1, 0), cube(1, 0, -1), cube(0, 1, -1)];
    const s = state({ obstacles, pieces: [{ id: "p1", label: 1, at: origin, movePoints: 5 }] });
    const path = movePath(s, "p1", cube(2, -1, -1))!;
    expect(path).not.toBeNull();
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
    const path = [origin, cube(1, -1, 0), cube(2, -2, 0)];
    const next = applyMove(state(), "p1", path);
    expect(next.pieces[0]!.at).toEqual({ x: 2, y: -2, z: 0 });
    expect(next.pieces[0]!.movePoints).toBe(1);
  });

  it("leaves other pieces alone and never mutates the input", () => {
    const s = state({
      pieces: [
        { id: "p1", label: 1, at: origin, movePoints: 3 },
        { id: "p2", label: 2, at: cube(-2, 1, 1), movePoints: 3 },
      ],
    });
    const frozen = structuredClone(s);
    const next = applyMove(s, "p1", [origin, cube(1, -1, 0)]);
    expect(next.pieces[1]).toEqual(s.pieces[1]);
    expect(s).toEqual(frozen);
  });
});

describe("moveAction reducer", () => {
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
    const view = moveView(s);
    expect(view.target).toEqual({ x: 2, y: -2, z: 0 });
    expect(view.arrow?.hexes).toHaveLength(3);

    s = moveAction(s, { type: "commit" });
    expect(s.phase).toBe("moving");
    expect(moveView(s).step).toMatchObject({ index: 0, count: 2 });

    s = runMove(s);
    expect(s.state.pieces[0]!.at).toEqual({ x: 2, y: -2, z: 0 });
    expect(s.state.pieces[0]!.movePoints).toBe(1);
    expect(s.phase).toBe("aiming"); // still has a point left
  });

  it("commit with an explicit hex skips the hover step", () => {
    let s = initMoveAction(state());
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "commit", hex: cube(1, -1, 0) });
    expect(s.phase).toBe("moving");
    s = runMove(s);
    expect(s.state.pieces[0]!.at).toEqual({ x: 1, y: -1, z: 0 });
  });

  it("goes to spent when the piece runs out of move points", () => {
    let s = initMoveAction(state({ pieces: [{ id: "p1", label: 1, at: origin, movePoints: 1 }] }));
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "commit", hex: cube(1, -1, 0) });
    s = runMove(s);
    expect(s.phase).toBe("spent");
    expect(moveView(s).reachable).toEqual([]);
  });

  it("re-selecting switches the active piece", () => {
    let s = initMoveAction(
      state({
        pieces: [
          { id: "p1", label: 1, at: origin, movePoints: 3 },
          { id: "p2", label: 2, at: cube(3, -3, 0), movePoints: 3 },
        ],
      }),
    );
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "hoverHex", hex: cube(1, -1, 0) });
    s = moveAction(s, { type: "selectPiece", pieceId: "p2" });
    expect(s.activeId).toBe("p2");
    expect(s.target).toBeNull();
    expect(moveView(s).active?.id).toBe("p2");
  });

  it("cancel returns to idle", () => {
    let s = initMoveAction(state());
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "cancel" });
    expect(s.phase).toBe("idle");
    expect(s.activeId).toBeNull();
  });

  it("ignores events that do not apply", () => {
    const s0 = initMoveAction(state());
    expect(moveAction(s0, { type: "hoverHex", hex: origin })).toBe(s0); // not aiming
    expect(moveAction(s0, { type: "advance" })).toBe(s0); // not moving
    expect(moveAction(s0, { type: "selectPiece", pieceId: "ghost" })).toBe(s0);

    let s = moveAction(s0, { type: "selectPiece", pieceId: "p1" });
    const before = s;
    s = moveAction(s, { type: "hoverHex", hex: cube(9, -9, 0) }); // unreachable
    expect(s.target).toBeNull();
    expect(moveAction(before, { type: "commit", hex: cube(9, -9, 0) })).toBe(before);
  });

  it("chains two moves within one budget and never mutates a snapshot", () => {
    let s = initMoveAction(state({ pieces: [{ id: "p1", label: 1, at: origin, movePoints: 4 }] }));
    const start = s;
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "commit", hex: cube(2, -2, 0) });
    s = runMove(s);
    expect(s.state.pieces[0]!.movePoints).toBe(2);
    s = moveAction(s, { type: "commit", hex: cube(2, -2, 0) }); // aiming again from the new spot
    // now at (2,-2,0); commit to (2,0,-2) is 2 away
    s = moveAction(s, { type: "hoverHex", hex: cube(2, 0, -2) });
    s = moveAction(s, { type: "commit" });
    s = runMove(s);
    expect(s.state.pieces[0]!.at).toEqual({ x: 2, y: 0, z: -2 });
    expect(s.state.pieces[0]!.movePoints).toBe(0);
    expect(start.phase).toBe("idle"); // original snapshot untouched
  });

  it("does not accept a new selection mid-move", () => {
    let s = initMoveAction(
      state({
        pieces: [
          { id: "p1", label: 1, at: origin, movePoints: 4 },
          { id: "p2", label: 2, at: cube(-3, 3, 0), movePoints: 4 },
        ],
      }),
    );
    s = moveAction(s, { type: "selectPiece", pieceId: "p1" });
    s = moveAction(s, { type: "commit", hex: cube(3, -3, 0) });
    expect(s.phase).toBe("moving");
    const mid = moveAction(s, { type: "selectPiece", pieceId: "p2" });
    expect(mid).toBe(s);
  });
});
