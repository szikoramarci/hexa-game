import { describe, expect, it } from "vitest";
import { cube, cubeEquals, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { rollDie, seedRng } from "../dice/dice.js";
import { ballCarrier, type MoveActionState, type Piece } from "../move-action/move-action.js";
import { pixelRangeCubes } from "../pixel-range/pixel-range.js";
import {
  applyPass,
  canPass,
  initPassAction,
  passAction,
  passArrow,
  passBlocked,
  passInterceptors,
  passLane,
  passRangeCubes,
  passTargets,
  passThreats,
  passView,
  type PassActionSnapshot,
} from "./pass-action.js";

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
    ball: origin,
    ...over,
  };
}

/** Walk a committed "passing" snapshot to completion. */
function runPass(snap: PassActionSnapshot): PassActionSnapshot {
  let s = snap;
  let guard = 0;
  while (s.phase === "passing" && guard++ < 50) {
    s = passAction(s, { type: "advance" });
  }
  return s;
}

/** First seed whose first `d6` roll is `6` (a pick-off at interceptOn 6). */
function seedRollingSix(): number {
  for (let s = 1; s < 100000; s++) if (rollDie(seedRng(s))[0] === 6) return s;
  throw new Error("no seed rolls a 6");
}
/** First seed whose first `n` `d6` rolls are all below 6. */
function seedNeverSix(n: number): number {
  for (let s = 1; s < 100000; s++) {
    let rng = seedRng(s);
    let ok = true;
    for (let i = 0; i < n; i++) {
      const [r, next] = rollDie(rng);
      if (r === 6) ok = false;
      rng = next;
    }
    if (ok) return s;
  }
  throw new Error("no calm seed");
}

describe("passRangeCubes / passTargets", () => {
  it("is the pixel range minus the carrier's own hex", () => {
    const got = passRangeCubes(state({ passRange: 4 }), "p1");
    const expected = pixelRangeCubes(origin, 4).filter((h) => !cubeEquals(h, origin));
    expect(keys(got)).toEqual(keys(expected));
    expect(got.some((h) => cubeEquals(h, origin))).toBe(false);
  });

  it("with no opponents, targets equal the range", () => {
    const s = state({ passRange: 4 });
    expect(keys(passTargets(s, "p1"))).toEqual(keys(passRangeCubes(s, "p1")));
  });

  it("throws for an unknown or non-carrier piece", () => {
    expect(() => passTargets(state(), "nope")).toThrow(RangeError);
    const s = state({
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "p2", at: cube(1, -1, 0) })],
    });
    expect(() => passTargets(s, "p2")).toThrow(RangeError);
  });
});

describe("shadow", () => {
  const enemy = cube(2, -2, 0); // 2 hexes east, on the origin→(4,-4,0) axis
  const s = state({ passRange: 5, pieces: [piece({ id: "p1", at: origin }), piece({ id: "d1", at: enemy, team: "away" })] });

  it("drops every hex whose lane passes through the opponent", () => {
    const targets = keys(passTargets(s, "p1"));
    expect(targets.has(cubeKey(cube(3, -3, 0)))).toBe(false); // behind the defender
    expect(targets.has(cubeKey(cube(4, -4, 0)))).toBe(false);
    expect(targets.has(cubeKey(cube(0, 3, -3)))).toBe(true); // off to the side
  });

  it("never offers the opponent's own hex", () => {
    expect(canPass(s, "p1", enemy)).toBe(false);
  });

  it("a teammate in the same spot blocks nothing", () => {
    const mate = state({
      passRange: 5,
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "m1", at: enemy, team: "home" })],
    });
    expect(keys(passTargets(mate, "p1"))).toEqual(keys(passRangeCubes(mate, "p1")));
    expect(passBlocked(mate, "p1", cube(4, -4, 0))).toBe(false);
  });

  it("passBlocked is true through an enemy, false past a teammate", () => {
    expect(passBlocked(s, "p1", cube(4, -4, 0))).toBe(true);
  });
});

describe("passLane / passArrow", () => {
  it("passLane is the supercover line from the carrier, carrier first", () => {
    const lane = passLane(state(), "p1", cube(0, 3, -3));
    expect(lane[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(lane.at(-1)).toEqual({ x: 0, y: 3, z: -3 });
  });

  it("passArrow is a solid straight two-point spec, null under two hexes", () => {
    expect(passArrow([origin])).toBeNull();
    const arrow = passArrow([origin, cube(0, 1, -1), cube(0, 2, -2)])!;
    expect(arrow.shape).toBe("straight");
    expect(arrow.dash).toBe("solid");
    expect(arrow.hexes).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 2, z: -2 },
    ]); // endpoints only, no corners
  });
});

describe("passInterceptors / passThreats", () => {
  // lane origin→(0,4,-4): (0,0,0)(0,1,-1)(0,2,-2)(0,3,-3)(0,4,-4)
  const flanker = piece({ id: "f1", at: cube(1, 4, -5), team: "away" }); // adjacent to the target hex only
  const presser = piece({ id: "x1", at: cube(1, -1, 0), team: "away" }); // adjacent to the carrier hex only
  const s = state({
    passRange: 5,
    pieces: [piece({ id: "p1", at: origin }), flanker, presser],
  });
  const target = cube(0, 4, -4);

  it("lists opponents flanking a flight hex, not the carrier hex", () => {
    const ids = passInterceptors(s, "p1", target).map((p) => p.id);
    expect(ids).toEqual(["f1"]);
  });

  it("passThreats are the flight hexes an opponent flanks", () => {
    expect(keys(passThreats(s, "p1", target))).toEqual(keys([cube(0, 4, -4)]));
  });
});

describe("applyPass", () => {
  it("moves the ball and never mutates the input", () => {
    const s = state();
    const frozen = structuredClone(s);
    const next = applyPass(s, cube(0, 2, -2));
    expect(next.ball).toEqual({ x: 0, y: 2, z: -2 });
    expect(s).toEqual(frozen);
  });
});

describe("reducer — flow", () => {
  it("selectPiece only arms the ball carrier", () => {
    const s = state({
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "p2", at: cube(1, -1, 0), team: "away" })],
    });
    let snap = initPassAction(s);
    expect(passAction(snap, { type: "selectPiece", pieceId: "p2" }).phase).toBe("idle");
    expect(passAction(snap, { type: "selectPiece", pieceId: "nope" }).phase).toBe("idle");
    snap = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    expect(snap.phase).toBe("aiming");
  });

  it("hover → commit → advance lands a clean pass loose on an empty hex", () => {
    let snap = initPassAction(state({ passRange: 5 }));
    snap = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    snap = passAction(snap, { type: "hoverHex", hex: cube(0, 3, -3) });
    expect(snap.target).toEqual({ x: 0, y: 3, z: -3 });
    snap = passAction(snap, { type: "commit" });
    expect(snap.phase).toBe("passing");
    snap = runPass(snap);
    expect(snap.phase).toBe("loose");
    expect(snap.state.ball).toEqual({ x: 0, y: 3, z: -3 });
    expect(ballCarrier(snap.state)).toBeNull();
  });

  it("a teammate on the target receives the pass", () => {
    const s = state({
      passRange: 5,
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "m1", at: cube(0, 3, -3), team: "home" })],
    });
    let snap = initPassAction(s);
    snap = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    snap = passAction(snap, { type: "commit", hex: cube(0, 3, -3) });
    snap = runPass(snap);
    expect(snap.phase).toBe("received");
    expect(passView(snap).receiver).toBe("m1");
    expect(ballCarrier(snap.state)?.id).toBe("m1");
  });

  it("blocked and out-of-range commits are no-ops", () => {
    const s = state({
      passRange: 3,
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "d1", at: cube(1, -1, 0), team: "away" })],
    });
    let snap = initPassAction(s);
    snap = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    expect(passAction(snap, { type: "commit", hex: cube(2, -2, 0) }).phase).toBe("aiming"); // shadowed
    expect(passAction(snap, { type: "commit", hex: cube(0, 8, -8) }).phase).toBe("aiming"); // out of range
  });

  it("cancel leaves any dead end for idle; not mid-flight", () => {
    let snap = initPassAction(state({ passRange: 5 }));
    snap = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    snap = passAction(snap, { type: "commit", hex: cube(0, 3, -3) });
    expect(passAction(snap, { type: "cancel" }).phase).toBe("passing");
    snap = runPass(snap);
    expect(passAction(snap, { type: "cancel" }).phase).toBe("idle");
  });
});

describe("reducer — interception", () => {
  const flanker = (over: Partial<Piece> = {}): Piece =>
    piece({ id: "f1", at: cube(1, 4, -5), team: "away", ...over });
  const target = cube(0, 4, -4);
  const build = (extra: Partial<MoveActionState> = {}) =>
    state({ passRange: 5, pieces: [piece({ id: "p1", at: origin }), flanker()], ...extra });

  const kick = (snap: PassActionSnapshot) => {
    let s = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    s = passAction(s, { type: "commit", hex: target });
    return runPass(s);
  };

  it("a rolled 6 next to the lane picks the pass off", () => {
    const snap = kick(initPassAction(build(), seedRollingSix()));
    expect(snap.phase).toBe("intercepted");
    expect(snap.state.ball).toEqual({ x: 1, y: 4, z: -5 });
    expect(snap.intercept?.by).toBe("f1");
    expect(snap.intercept?.rolls.at(-1)).toEqual({ id: "f1", roll: 6 });
    expect(ballCarrier(snap.state)?.id).toBe("f1");
  });

  it("a calm seed completes the pass", () => {
    const snap = kick(initPassAction(build(), seedNeverSix(4)));
    expect(snap.phase).toBe("loose");
    expect(snap.rolls.length).toBeGreaterThan(0); // it did roll, just missed
  });

  it("interceptOn lowered picks it off on the first roll", () => {
    const snap = kick(initPassAction(build({ interceptOn: 1 }), 1));
    expect(snap.phase).toBe("intercepted");
  });

  it("an opponent flanking two lane hexes rolls once", () => {
    const twoHexFlanker = piece({ id: "f2", at: cube(1, 3, -4), team: "away" }); // adj to (0,3,-3) and (0,4,-4)
    const s = state({ passRange: 5, pieces: [piece({ id: "p1", at: origin }), twoHexFlanker] });
    const snap = kick(initPassAction(s, seedNeverSix(4)));
    expect(snap.rolls.filter((r) => r.id === "f2")).toHaveLength(1);
  });

  it("rng advances one draw per roll", () => {
    const seed = seedNeverSix(4);
    const snap = kick(initPassAction(build(), seed));
    let rng = seedRng(seed);
    for (let i = 0; i < snap.rolls.length; i++) rng = rollDie(rng)[1];
    expect(snap.rng).toBe(rng);
  });

  it("replays identically from a fixed seed", () => {
    const a = kick(initPassAction(build(), 12345));
    const b = kick(initPassAction(build(), 12345));
    expect(a.phase).toBe(b.phase);
    expect(a.rolls).toEqual(b.rolls);
    expect(a.state.ball).toEqual(b.state.ball);
  });
});

describe("passView", () => {
  it("exposes targets, blocked and the greyed shadow only while aiming", () => {
    const s = state({
      passRange: 5,
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "d1", at: cube(2, -2, 0), team: "away" })],
    });
    let snap = initPassAction(s);
    expect(passView(snap).targets).toEqual([]);
    snap = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    const v = passView(snap);
    expect(v.targets.length).toBeGreaterThan(0);
    expect(v.blocked.some((h) => cubeEquals(h, cube(3, -3, 0)))).toBe(true);
  });

  it("hands one flight step at a time with the contest ids", () => {
    const s = state({
      passRange: 5,
      pieces: [piece({ id: "p1", at: origin }), piece({ id: "f1", at: cube(1, 4, -5), team: "away" })],
    });
    let snap = initPassAction(s, seedNeverSix(4));
    snap = passAction(snap, { type: "selectPiece", pieceId: "p1" });
    snap = passAction(snap, { type: "commit", hex: cube(0, 4, -4) });
    const steps: string[][] = [];
    let guard = 0;
    while (passView(snap).step && guard++ < 20) {
      steps.push(passView(snap).step!.contest);
      snap = passAction(snap, { type: "advance" });
    }
    expect(steps.some((c) => c.includes("f1"))).toBe(true);
  });
});
