import { describe, expect, it } from "vitest";
import {
  cube,
  cubeEquals,
  cubeKey,
  type Cube,
} from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";
import { rollDie, seedRng } from "../dice/dice.js";
import {
  ballCarrier,
  type MoveActionState,
  type Piece,
} from "../move-action/move-action.js";
import { pixelRangeCubes } from "../pixel-range/pixel-range.js";
import {
  applyHighPass,
  canHighPass,
  headerContestants,
  highPassAction,
  highPassArrow,
  highPassBlocked,
  highPassLandingZone,
  highPassRangeCubes,
  highPassReceivers,
  highPassShadow,
  highPassTargets,
  highPassView,
  initHighPass,
  type HighPassSnapshot,
} from "./high-pass.js";

const O = cube(0, 0, 0);
const keys = (hexes: Iterable<Cube>) => new Set([...hexes].map(cubeKey));

const pc = (over: Partial<Piece> & Pick<Piece, "id" | "at">): Piece => ({
  label: 1,
  movePoints: 3,
  team: "home",
  ...over,
});

/** carrier p1 at origin, teammate m1 far south-east, one distant defender. */
function base(over: Partial<MoveActionState> = {}): MoveActionState {
  return {
    pieces: [
      pc({ id: "p1", at: O }),
      pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
      pc({ id: "d1", at: cube(2, -3, 1), team: "away" }),
    ],
    obstacles: [],
    ball: O,
    ...over,
  };
}

const firstSeed = (pred: (seed: number) => boolean): number => {
  for (let s = 1; s < 200000; s++) if (pred(s)) return s;
  throw new Error("no seed matched");
};

/** Drive a committed snapshot through the reactions by skipping every slot. */
function skipReactions(snap: HighPassSnapshot): HighPassSnapshot {
  let s = snap;
  let guard = 0;
  while (s.phase === "reacting" && guard++ < 20) {
    if (highPassView(s).reaction?.needsPiece) {
      const foe = highPassView(s).reaction!.candidates[0];
      s = foe
        ? highPassAction(s, { type: "reactPiece", pieceId: foe.id })
        : highPassAction(s, { type: "reactSkip" });
    }
    s = highPassAction(s, { type: "reactSkip" });
  }
  return s;
}

/** From `rolling`, roll accuracy and fly the loft to its landing. */
function runToArrival(snap: HighPassSnapshot): HighPassSnapshot {
  let s = highPassAction(snap, { type: "advance" }); // accuracy roll -> flight
  let guard = 0;
  while (highPassView(s).step && guard++ < 40) {
    s = highPassAction(s, { type: "advance" });
  }
  return s;
}

/** selectPiece -> selectReceiver -> commit(target). */
function aim(
  state: MoveActionState,
  target: Cube,
  seed: number | string = 1,
  receiverId = "m1",
): HighPassSnapshot {
  let s = initHighPass(state, seed);
  s = highPassAction(s, { type: "selectPiece", pieceId: "p1" });
  s = highPassAction(s, { type: "selectReceiver", pieceId: receiverId });
  s = highPassAction(s, { type: "commit", hex: target });
  return s;
}

describe("highPassRangeCubes / min distance", () => {
  it("is the pixel disc with the inner three rings removed", () => {
    const got = highPassRangeCubes(base({ highPassRange: 8 }), "p1");
    const expected = pixelRangeCubes(O, 8).filter(
      (h) => cubeDistance(O, h) >= 4,
    );
    expect(keys(got)).toEqual(keys(expected));
    expect(got.every((h) => cubeDistance(O, h) >= 4)).toBe(true);
    expect(got.some((h) => cubeEquals(h, O))).toBe(false);
  });

  it("throws for an unknown or non-carrier piece", () => {
    expect(() => highPassRangeCubes(base(), "nope")).toThrow(RangeError);
    expect(() => highPassRangeCubes(base(), "m1")).toThrow(RangeError);
  });
});

describe("shadow", () => {
  const adj = cube(1, -1, 0); // east neighbour of the carrier
  const withAdjFoe = base({
    highPassRange: 9,
    pieces: [
      pc({ id: "p1", at: O }),
      pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
      pc({ id: "d1", at: adj, team: "away" }),
    ],
  });

  it("an adjacent opponent removes every hex whose lane runs through it", () => {
    const zone = keys(highPassLandingZone(withAdjFoe, "p1"));
    expect(zone.has(cubeKey(cube(5, -5, 0)))).toBe(false); // straight behind d1
    expect(zone.has(cubeKey(cube(0, 5, -5)))).toBe(true); // off to the side
  });

  it("an opponent two hexes away on the same line blocks nothing", () => {
    const far = base({
      highPassRange: 9,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
        pc({ id: "d1", at: cube(2, -2, 0), team: "away" }),
      ],
    });
    expect(keys(highPassLandingZone(far, "p1"))).toEqual(
      keys(highPassRangeCubes(far, "p1")),
    );
    expect(highPassBlocked(far, "p1", cube(5, -5, 0))).toBe(false);
  });

  it("a teammate next to the carrier blocks nothing", () => {
    const mate = base({
      highPassRange: 9,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "m1", at: adj, team: "home" }),
      ],
    });
    expect(keys(highPassLandingZone(mate, "p1"))).toEqual(
      keys(highPassRangeCubes(mate, "p1")),
    );
  });

  it("highPassBlocked is true through the adjacent enemy, false elsewhere", () => {
    expect(highPassBlocked(withAdjFoe, "p1", cube(5, -5, 0))).toBe(true);
    expect(highPassBlocked(withAdjFoe, "p1", cube(0, 5, -5))).toBe(false);
    expect(highPassShadow(withAdjFoe, "p1")).toEqual([{ x: 1, y: -1, z: 0 }]);
  });
});

describe("receivers / targets", () => {
  const s = base({
    highPassRange: 9,
    pieces: [
      pc({ id: "p1", at: O }),
      pc({ id: "m2", at: cube(6, -6, 0), team: "home" }),
      pc({ id: "m1", at: cube(-6, 0, 6), team: "home" }),
      pc({ id: "d1", at: cube(3, 0, -3), team: "away" }),
    ],
  });

  it("highPassReceivers are the carrier's teammates that can be reached, id-sorted", () => {
    expect(highPassReceivers(s, "p1").map((p) => p.id)).toEqual(["m1", "m2"]);
  });

  it("a teammate shut out of the zone — even after its run — is not a receiver", () => {
    const boxed = base({
      highPassRange: 9,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "d1", at: cube(1, -1, 0), team: "away" }), // adjacent, shadows east
        pc({ id: "m1", at: cube(6, -6, 0), team: "home" }), // due east, boxed in
        pc({ id: "m2", at: cube(-1, 4, -3), team: "home" }), // clear
      ],
    });
    expect(highPassTargets(boxed, "p1", "m1")).toEqual([]);
    expect(highPassReceivers(boxed, "p1").map((p) => p.id)).toEqual(["m2"]);
    // and the reducer will not let it be picked
    let snap = initHighPass(boxed);
    snap = highPassAction(snap, { type: "selectPiece", pieceId: "p1" });
    expect(
      highPassAction(snap, { type: "selectReceiver", pieceId: "m1" }).phase,
    ).toBe("receiver");
    expect(highPassView(snap).receivers.map((p) => p.id)).toEqual(["m2"]);
  });

  it("a shadowed teammate that can run clear stays a receiver", () => {
    const escape = base({
      highPassRange: 9,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "d1", at: cube(1, -1, 0), team: "away" }),
        pc({ id: "m1", at: cube(2, -2, 0), team: "home" }), // in the shadow now
      ],
    });
    expect(highPassBlocked(escape, "p1", cube(2, -2, 0))).toBe(true);
    expect(highPassReceivers(escape, "p1").map((p) => p.id)).toEqual(["m1"]);
    const targets = highPassTargets(escape, "p1", "m1");
    expect(targets.length).toBeGreaterThan(0);
    expect(
      targets.every((t) => !highPassBlocked(escape, "p1", t)),
    ).toBe(true);
  });

  it("highPassTargets is the landing zone within 3 hexes of the receiver", () => {
    const zone = keys(highPassLandingZone(s, "p1"));
    for (const h of highPassTargets(s, "p1", "m2")) {
      expect(zone.has(cubeKey(h))).toBe(true);
      expect(cubeDistance(h, cube(6, -6, 0))).toBeLessThanOrEqual(3);
    }
    expect(highPassTargets(s, "p1", "m2").length).toBeGreaterThan(0);
  });

  it("a receiver far from any legal landing hex gets no targets", () => {
    const far = base({
      highPassRange: 8,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "m1", at: cube(0, 20, -20), team: "home" }),
      ],
    });
    expect(highPassTargets(far, "p1", "m1")).toEqual([]);
  });

  it("targets the receiver cannot run to — a wall of pieces in the way — drop out", () => {
    const open = base({
      highPassRange: 9,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "m1", at: cube(8, -8, 0), team: "home" }),
      ],
    });
    // the same board, but three pieces box the receiver's run to the north-west
    const walled = base({
      highPassRange: 9,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "m1", at: cube(8, -8, 0), team: "home" }),
        pc({ id: "w1", at: cube(7, -7, 0), team: "away" }),
        pc({ id: "w2", at: cube(7, -8, 1), team: "away" }),
        pc({ id: "w3", at: cube(8, -7, -1), team: "away" }),
      ],
    });
    const openT = keys(highPassTargets(open, "p1", "m1"));
    const walledT = keys(highPassTargets(walled, "p1", "m1"));
    expect(walledT.size).toBeLessThan(openT.size);
    // hexes beyond the wall are no longer reachable in 3 steps
    expect(openT.has(cubeKey(cube(6, -7, 1)))).toBe(true);
    expect(walledT.has(cubeKey(cube(6, -7, 1)))).toBe(false);
  });

  it("canHighPass agrees with membership; a non-teammate receiver throws", () => {
    const t = highPassTargets(s, "p1", "m2")[0]!;
    expect(canHighPass(s, "p1", "m2", t)).toBe(true);
    expect(canHighPass(s, "p1", "m2", cube(0, 0, 0))).toBe(false);
    expect(() => highPassTargets(s, "p1", "d1")).toThrow(RangeError);
    expect(() => highPassTargets(s, "p1", "nope")).toThrow(RangeError);
  });
});

describe("highPassArrow", () => {
  it("is a two-hex curved jump arc, null when the ends coincide", () => {
    expect(highPassArrow(O, O)).toBeNull();
    const a = highPassArrow(O, cube(5, -5, 0))!;
    expect(a.shape).toBe("curved");
    expect(a.hexes).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 5, y: -5, z: 0 },
    ]);
  });
});

describe("reactions", () => {
  const target = cube(5, -5, 0); // dist 5 from carrier, dist 2 from m1

  it("commit builds a receiver + opponent queue outside the box", () => {
    const s = aim(base({ highPassRange: 9 }), target);
    expect(s.phase).toBe("reacting");
    expect(s.reactions.map((r) => r.role)).toEqual(["receiver", "opponent"]);
    expect(s.reactions[0]).toMatchObject({ pieceId: "m1", budget: 3 });
    expect(s.reactions[1]).toMatchObject({ pieceId: null, budget: 3 });
  });

  it("adds a keeper slot in the box — budget 4 within 5 hexes, else 1", () => {
    const near = aim(
      base({
        highPassRange: 9,
        penaltyArea: [target],
        pieces: [
          pc({ id: "p1", at: O }),
          pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
          pc({ id: "gk", at: cube(7, -7, 0), team: "away", role: "goalkeeper" }),
        ],
      }),
      target,
    );
    expect(near.reactions.map((r) => r.role)).toEqual([
      "receiver",
      "opponent",
      "keeper",
    ]);
    expect(near.reactions[2]).toMatchObject({ pieceId: "gk", budget: 4 });

    const far = aim(
      base({
        highPassRange: 9,
        penaltyArea: [target],
        pieces: [
          pc({ id: "p1", at: O }),
          pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
          pc({ id: "gk", at: cube(0, 12, -12), team: "away", role: "goalkeeper" }),
        ],
      }),
      target,
    );
    expect(far.reactions[2]).toMatchObject({ budget: 1 });
  });

  it("keeper is left out of the slot-2 opponent candidates", () => {
    const s = aim(
      base({
        highPassRange: 9,
        penaltyArea: [target],
        pieces: [
          pc({ id: "p1", at: O }),
          pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
          pc({ id: "d1", at: cube(3, 0, -3), team: "away" }),
          pc({ id: "gk", at: cube(6, -6, 0), team: "away", role: "goalkeeper" }),
        ],
      }),
      target,
    );
    const afterReceiver = highPassAction(s, { type: "reactSkip" });
    const cands = highPassView(afterReceiver).reaction!.candidates.map(
      (p) => p.id,
    );
    expect(cands).toEqual(["d1"]);
  });

  it("reactPiece then reactMove walks the queue; out-of-reach is a no-op", () => {
    let s = aim(
      base({
        highPassRange: 9,
        pieces: [
          pc({ id: "p1", at: O }),
          pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
          pc({ id: "d1", at: cube(3, -1, -2), team: "away" }),
        ],
      }),
      target,
    );
    // slot 0 — receiver
    const rMove = highPassView(s).reaction!.reach[0]!;
    s = highPassAction(s, { type: "reactMove", hex: rMove });
    expect(s.state.pieces.find((p) => p.id === "m1")!.at).toEqual(rMove);
    // slot 1 — opponent, needs a pick
    expect(highPassView(s).reaction!.needsPiece).toBe(true);
    expect(highPassAction(s, { type: "reactMove", hex: rMove }).phase).toBe(
      "reacting",
    ); // no piece yet
    s = highPassAction(s, { type: "reactPiece", pieceId: "d1" });
    expect(
      highPassAction(s, { type: "reactMove", hex: cube(9, -9, 0) }),
    ).toBe(s); // out of reach
    const dMove = highPassView(s).reaction!.reach[0]!;
    s = highPassAction(s, { type: "reactMove", hex: dMove });
    expect(s.phase).toBe("rolling");
  });

  it("no keeper slot without a keeper or when the landing is outside the box", () => {
    const s = aim(base({ highPassRange: 9, penaltyArea: [cube(9, -9, 0)] }), target);
    expect(s.reactions.some((r) => r.role === "keeper")).toBe(false);
  });
});

describe("accuracy", () => {
  const target = cube(5, -5, 0);

  it("an accurate loft lands on the target hex", () => {
    const s = runToArrival(
      skipReactions(aim(base({ highPassRange: 9, highPassAccuracyOn: 2 }), target)),
    );
    expect(s.accuracy?.accurate).toBe(true);
    expect(s.arrivalHex).toEqual({ x: 5, y: -5, z: 0 });
  });

  it("a miss scatters with looseBall from the target — empty stoppers", () => {
    const s = runToArrival(
      skipReactions(
        aim(
          base({
            highPassRange: 9,
            highPassAccuracyOn: 99,
            pieces: [
              pc({ id: "p1", at: O }),
              pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
              pc({ id: "d1", at: cube(5, -6, 1), team: "away" }),
              pc({ id: "d2", at: cube(6, -5, -1), team: "away" }),
            ],
          }),
          target,
        ),
      ),
    );
    expect(s.accuracy?.accurate).toBe(false);
    expect(s.scatter).not.toBeNull();
    expect(s.scatter!.route[0]).toEqual({ x: 5, y: -5, z: 0 });
    expect(s.scatter!.caughtBy).toBeNull(); // no stoppers — direction/distance only
    expect(s.arrivalHex).toEqual(s.scatter!.rest);
  });

  it("highPassAccuracyOn tunes the threshold", () => {
    const lo = runToArrival(
      skipReactions(aim(base({ highPassRange: 9, highPassAccuracyOn: 2 }), target)),
    );
    const hi = runToArrival(
      skipReactions(aim(base({ highPassRange: 9, highPassAccuracyOn: 13 }), target)),
    );
    expect(lo.accuracy?.accurate).toBe(true);
    expect(hi.accuracy?.accurate).toBe(false);
  });
});

describe("headerContestants", () => {
  it("rings 0/1 bring the full attr, ring 2 brings attr - 1, ring 3+ is out", () => {
    const s: MoveActionState = {
      pieces: [
        pc({ id: "a", at: O, attrs: { heading: 4 } }),
        pc({ id: "b", at: cube(1, -1, 0), attrs: { heading: 5 } }),
        pc({ id: "c", at: cube(2, -2, 0), team: "away", attrs: { heading: 3 } }),
        pc({
          id: "g",
          at: cube(0, 2, -2),
          team: "away",
          role: "goalkeeper",
          attrs: { aerial: 6 },
        }),
        pc({ id: "d", at: cube(3, -3, 0), team: "away", attrs: { heading: 6 } }),
      ],
      obstacles: [],
    };
    const entries = headerContestants(s, O);
    expect(entries.map((e) => e.id)).toEqual(["a", "b", "c", "g"]);
    expect(entries.find((e) => e.id === "a")).toMatchObject({
      dist: 0,
      attr: 4,
      reduced: false,
    });
    expect(entries.find((e) => e.id === "c")).toMatchObject({
      dist: 2,
      attr: 2,
      reduced: true,
    });
    expect(entries.find((e) => e.id === "g")).toMatchObject({
      dist: 2,
      attr: 5, // goalkeeper aerial 6, reduced by 1
      reduced: true,
    });
  });
});

describe("header contest — reducer", () => {
  const target = cube(5, -5, 0);

  function contested(over: Partial<MoveActionState>): MoveActionState {
    return base({
      highPassRange: 9,
      highPassAccuracyOn: 2, // always accurate — arrival is the target
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "m1", at: cube(6, -5, -1), team: "home", attrs: { heading: 5 } }),
        pc({ id: "d1", at: cube(5, -6, 1), team: "away", attrs: { heading: 2 } }),
        pc({ id: "d2", at: cube(4, -5, 1), team: "away", attrs: { heading: 3 } }),
      ],
      ...over,
    });
  }

  it("highest score wins the header — ball lands, phase headed", () => {
    const s = runToArrival(skipReactions(aim(contested({}), target, 7)));
    expect(["headed", "loose"]).toContain(s.phase);
    expect(s.header).not.toBeNull();
    const scores = s.header!.rolls.map((r) => r.score);
    // rolls come in ascending distance then id order
    const dists = s.header!.rolls.map((r) => r.dist);
    expect([...dists]).toEqual([...dists].sort((a, b) => a - b));
    if (s.phase === "headed") {
      const top = Math.max(...scores);
      expect(s.header!.rolls.find((r) => r.id === s.header!.winner)!.score).toBe(
        top,
      );
      expect(s.state.ball).toEqual({ x: 5, y: -5, z: 0 });
    }
  });

  it("a tie for the top score spills a loose ball", () => {
    // stealDie 1 → every contest d6 is 1; two equal-attr contestants at the
    // same ring tie.
    const s = runToArrival(
      skipReactions(
        aim(
          contested({
            stealDie: 1,
            pieces: [
              pc({ id: "p1", at: O }),
              pc({ id: "m1", at: cube(6, -5, -1), team: "home", attrs: { heading: 4 } }),
              pc({ id: "d1", at: cube(5, -6, 1), team: "away", attrs: { heading: 4 } }),
            ],
          }),
          target,
        ),
      ),
    );
    expect(s.phase).toBe("loose");
    expect(s.header!.winner).toBeNull();
    expect(s.state.ball).toEqual({ x: 5, y: -5, z: 0 });
  });

  it("nobody within two hexes — loose straight away, no rolls", () => {
    const s = runToArrival(
      skipReactions(
        aim(
          base({
            highPassRange: 9,
            highPassAccuracyOn: 2,
            pieces: [
              pc({ id: "p1", at: O }),
              // exactly 3 hexes from the target — legal to aim at, but out of
              // the header rings once it lands there.
              pc({ id: "m1", at: cube(5, -2, -3), team: "home" }),
            ],
          }),
          target,
        ),
      ),
    );
    expect(s.phase).toBe("loose");
    expect(s.header!.rolls).toEqual([]);
    expect(s.header!.winner).toBeNull();
  });
});

describe("reducer — flow", () => {
  const target = cube(5, -5, 0);

  it("selectPiece only arms the carrier; selectReceiver only a teammate", () => {
    let s = initHighPass(base());
    expect(highPassAction(s, { type: "selectPiece", pieceId: "d1" }).phase).toBe(
      "idle",
    );
    expect(highPassAction(s, { type: "selectPiece", pieceId: "m1" }).phase).toBe(
      "idle",
    );
    s = highPassAction(s, { type: "selectPiece", pieceId: "p1" });
    expect(s.phase).toBe("receiver");
    expect(
      highPassAction(s, { type: "selectReceiver", pieceId: "d1" }).phase,
    ).toBe("receiver");
    s = highPassAction(s, { type: "selectReceiver", pieceId: "m1" });
    expect(s.phase).toBe("aiming");
  });

  it("walks idle → receiver → aiming → reacting → rolling → flight → headed/loose", () => {
    const phases: string[] = [];
    let s = initHighPass(base({ highPassRange: 9, highPassAccuracyOn: 2 }));
    s = highPassAction(s, { type: "selectPiece", pieceId: "p1" });
    phases.push(s.phase);
    s = highPassAction(s, { type: "selectReceiver", pieceId: "m1" });
    phases.push(s.phase);
    s = highPassAction(s, { type: "hoverHex", hex: target });
    s = highPassAction(s, { type: "commit" });
    phases.push(s.phase);
    s = skipReactions(s);
    phases.push(s.phase);
    s = runToArrival(s);
    phases.push(s.phase);
    expect(phases).toEqual([
      "receiver",
      "aiming",
      "reacting",
      "rolling",
      expect.stringMatching(/headed|loose/),
    ]);
  });

  it("cancel returns to idle from every phase but flight", () => {
    let s = aim(base({ highPassRange: 9 }), target);
    expect(highPassAction(s, { type: "cancel" }).phase).toBe("idle"); // reacting
    s = skipReactions(s);
    expect(highPassAction(s, { type: "cancel" }).phase).toBe("idle"); // rolling
    s = highPassAction(s, { type: "advance" }); // -> flight
    expect(s.phase).toBe("flight");
    expect(highPassAction(s, { type: "cancel" }).phase).toBe("flight");
  });

  it("replays identically from a fixed seed and events", () => {
    const run = () => {
      let s = aim(base({ highPassRange: 9 }), target, "match-7");
      s = skipReactions(s);
      return runToArrival(s);
    };
    const a = run();
    const b = run();
    expect(a.phase).toBe(b.phase);
    expect(a.accuracy).toEqual(b.accuracy);
    expect(a.scatter).toEqual(b.scatter);
    expect(a.header).toEqual(b.header);
    expect(a.state.ball).toEqual(b.state.ball);
  });
});

describe("applyHighPass", () => {
  it("moves the ball and never mutates the input", () => {
    const s = base();
    const frozen = structuredClone(s);
    const next = applyHighPass(s, cube(5, -5, 0));
    expect(next.ball).toEqual({ x: 5, y: -5, z: 0 });
    expect(s).toEqual(frozen);
  });
});

describe("highPassView", () => {
  it("exposes receivers, then targets + shadow while aiming", () => {
    const s0 = base({
      highPassRange: 9,
      pieces: [
        pc({ id: "p1", at: O }),
        pc({ id: "m1", at: cube(7, -7, 0), team: "home" }),
        // adjacent to the carrier but off the east axis — shadows the south
        // wedge, leaves the lane to m1 open.
        pc({ id: "d1", at: cube(0, 1, -1), team: "away" }),
      ],
    });
    let snap = initHighPass(s0);
    snap = highPassAction(snap, { type: "selectPiece", pieceId: "p1" });
    expect(highPassView(snap).receivers.map((p) => p.id)).toEqual(["m1"]);
    snap = highPassAction(snap, { type: "selectReceiver", pieceId: "m1" });
    const v = highPassView(snap);
    expect(v.targets.length).toBeGreaterThan(0);
    expect(v.shadow).toEqual([{ x: 0, y: 1, z: -1 }]);
    expect(v.blocked.length).toBeGreaterThan(0);
  });

  it("hands the flight as an arc step, then the header roster", () => {
    let s = skipReactions(
      aim(base({ highPassRange: 9, highPassAccuracyOn: 2 }), cube(5, -5, 0)),
    );
    s = highPassAction(s, { type: "advance" }); // -> flight
    const step = highPassView(s).step!;
    expect(step).toMatchObject({ index: 0, count: 5 });
    expect(step.from).toEqual({ x: 0, y: 0, z: 0 });
    expect(step.to).toEqual({ x: 5, y: -5, z: 0 });
  });
});

// A guard so the helper import of seedRng/rollDie/ballCarrier/firstSeed stays used
// even if a test above is trimmed.
describe("determinism helpers", () => {
  it("firstSeed finds a seed and ballCarrier tracks the ball", () => {
    const seed = firstSeed((s) => rollDie(seedRng(s))[0] === 6);
    expect(rollDie(seedRng(seed))[0]).toBe(6);
    expect(ballCarrier(base())?.id).toBe("p1");
  });
});
