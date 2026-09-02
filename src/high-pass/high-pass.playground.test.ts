import { describe, expect, it } from "vitest";
import { cube, cubeKey, type Cube } from "../coordinates/coordinates.js";
import type { MoveActionState, Piece } from "../move-action/move-action.js";
import {
  writeHighPassPlayground,
  type HighPassCase,
} from "../test-utils/high-pass-playground.js";
import { rollDie, seedRng } from "../dice/dice.js";
import {
  CUBE_DIRECTIONS,
  cubeAdd,
  cubeEquals,
  cubeScale,
} from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";
import {
  highPassAction,
  highPassBlocked,
  highPassLandingZone,
  highPassReceivers,
  highPassShadow,
  highPassTargets,
  highPassView,
  initHighPass,
  reactReach,
  type HighPassSnapshot,
} from "./high-pass.js";

const O = cube(0, 0, 0);

const CASES: HighPassCase[] = [
  {
    title: "switch of play",
    radius: 9,
    pieces: [
      { at: O, label: "A", team: "home", hasBall: true, highPass: 5 },
      { at: cube(6, -6, 0), label: "B", team: "home", heading: 4 },
      { at: cube(2, 1, -3), label: "D", team: "away", heading: 3 },
    ],
  },
  {
    title: "lofted over a marker",
    radius: 9,
    seed: 7,
    pieces: [
      { at: O, label: "A", team: "home", hasBall: true, highPass: 4 },
      { at: cube(1, -1, 0), label: "M", team: "away", heading: 4 },
      { at: cube(-2, 6, -4), label: "B", team: "home", heading: 5 },
    ],
  },
  {
    title: "cross into the box",
    radius: 10,
    seed: 3,
    highPassAccuracyOn: 7,
    penaltyArea: [
      cube(6, -6, 0),
      cube(7, -6, -1),
      cube(6, -5, -1),
      cube(7, -7, 0),
      cube(5, -5, 0),
    ],
    pieces: [
      { at: O, label: "A", team: "home", hasBall: true, highPass: 5 },
      { at: cube(5, -4, -1), label: "B", team: "home", heading: 4 },
      { at: cube(7, -6, -1), label: "D", team: "away", heading: 4 },
      {
        at: cube(9, -7, -2),
        label: "G",
        team: "away",
        role: "goalkeeper",
        heading: 6,
      },
    ],
  },
  {
    title: "miss under pressure",
    radius: 9,
    seed: 5,
    pieces: [
      { at: O, label: "A", team: "home", hasBall: true, highPass: 1 },
      { at: cube(5, -5, 0), label: "B", team: "home", heading: 3 },
      { at: cube(5, -6, 1), label: "D1", team: "away", heading: 4 },
      { at: cube(6, -5, -1), label: "D2", team: "away", heading: 3 },
    ],
  },
  {
    title: "pick a runner — three teammates ahead",
    radius: 10,
    seed: 11,
    pieces: [
      { at: O, label: "A", team: "home", hasBall: true, highPass: 5 },
      { at: cube(6, -6, 0), label: "B1", team: "home", heading: 4 },
      { at: cube(2, 4, -6), label: "B2", team: "home", heading: 5 },
      { at: cube(7, -3, -4), label: "B3", team: "home", heading: 3 },
      { at: cube(4, -2, -2), label: "D1", team: "away", heading: 4 },
      { at: cube(2, 3, -5), label: "D2", team: "away", heading: 3 },
    ],
  },
  {
    title: "blocked — a marker shuts a teammate out",
    radius: 9,
    seed: 9,
    pieces: [
      { at: O, label: "A", team: "home", hasBall: true, highPass: 4 },
      // D stands right next to A, on the line to B. Every hex B could run to in
      // the range disc is behind D — B is not even selectable. Hit C instead.
      { at: cube(1, -1, 0), label: "D", team: "away", heading: 4 },
      { at: cube(6, -6, 0), label: "B", team: "home", heading: 4 },
      { at: cube(3, 1, -4), label: "C", team: "home", heading: 3 },
    ],
  },
  {
    title: "shadow clips the run",
    radius: 9,
    seed: 13,
    pieces: [
      { at: O, label: "A", team: "home", hasBall: true, highPass: 5 },
      { at: cube(1, -1, 0), label: "D", team: "away", heading: 4 },
      // B stands clear, but D's wedge cuts across the near side of B's run —
      // part of B's landing circle is blue, part greys out.
      { at: cube(5, -2, -3), label: "B", team: "home", heading: 4 },
      { at: cube(-1, 5, -4), label: "C", team: "home", heading: 3 },
    ],
  },
];

const html = writeHighPassPlayground(
  "high-pass",
  "the high pass",
  "Loft the ball to a hex a teammate runs onto.",
  CASES,
);

interface Baked {
  size: number;
  board: string[];
  penaltyArea: string[];
  pieces: { id: string; at: string; role: string; hdr: number }[];
  carrierId: string;
  carrierAt: string;
  carrierHighPass: number;
  receivers: string[];
  perReceiver: Record<
    string,
    { zone: string[]; targets: string[]; blocked: string[] }
  >;
  shadow: string[];
  accuracyOn: number;
  seed: number;
}

function bakedCases(): Baked[] {
  const m = html.match(/var CASES = (\[[\s\S]*?\]);\nfunction parse/);
  if (!m) throw new Error("could not find the baked CASES manifest");
  return (JSON.parse(m[1]!) as Array<{ data: Baked }>).map((c) => c.data);
}

function stateFor(c: HighPassCase): {
  state: MoveActionState;
  carrierId: string;
} {
  const pieces: Piece[] = c.pieces.map((p, i) => {
    const attrs: NonNullable<Piece["attrs"]> = {};
    if (p.heading != null) {
      attrs.heading = p.heading;
      attrs.aerial = p.heading;
    }
    if (p.highPass != null) attrs.highPass = p.highPass;
    const piece: Piece = {
      id: `p${i}`,
      label: p.label,
      at: p.at,
      movePoints: 3,
      team: p.team,
      attrs,
    };
    if (p.role) piece.role = p.role;
    return piece;
  });
  const ci = Math.max(
    0,
    c.pieces.findIndex((p) => p.hasBall),
  );
  return {
    state: {
      pieces,
      obstacles: [],
      ball: pieces[ci]!.at,
      highPassRange: c.highPassRange ?? 8,
      highPassAccuracyOn: c.highPassAccuracyOn ?? 8,
      penaltyArea: c.penaltyArea ?? [],
    },
    carrierId: `p${ci}`,
  };
}

const asSet = (xs: Iterable<Cube>) => new Set([...xs].map(cubeKey));

describe("high-pass playground page", () => {
  it("puts every case on the one page", () => {
    CASES.forEach((c, i) => {
      expect(html).toContain(`id="case-${i}"`);
      expect(html).toContain(`<h2>${c.title}</h2>`);
    });
    expect(html).toContain('href="../../index.html"');
    expect(html).toContain('class="reset"');
    expect(html).toContain('class="skip"');
  });

  it("bakes exactly the module's receivers, landing zone and per-receiver targets", () => {
    bakedCases().forEach((data, i) => {
      const { state, carrierId } = stateFor(CASES[i]!);
      const recs = highPassReceivers(state, carrierId);
      expect(data.receivers).toEqual(recs.map((r) => r.id));
      expect(new Set(data.shadow)).toEqual(
        asSet(highPassShadow(state, carrierId)),
      );
      const zone = asSet(highPassLandingZone(state, carrierId));
      for (const r of recs) {
        expect(new Set(data.perReceiver[r.id]!.zone)).toEqual(zone);
        expect(new Set(data.perReceiver[r.id]!.targets)).toEqual(
          asSet(highPassTargets(state, carrierId, r.id)),
        );
      }
    });
  });

  it("bakes the penalty area and keeper role for the box case", () => {
    const box = bakedCases()[2]!;
    expect(box.penaltyArea.length).toBe(5);
    expect(box.pieces.some((p) => p.role === "goalkeeper")).toBe(true);
  });

  it("carries the accuracy knobs the module would use", () => {
    bakedCases().forEach((data, i) => {
      expect(data.accuracyOn).toBe(CASES[i]!.highPassAccuracyOn ?? 8);
      const carrier = CASES[i]!.pieces.find((p) => p.hasBall)!;
      expect(data.carrierHighPass).toBe(carrier.highPass ?? 3);
    });
  });

  it("registers the action on the landing nav", () => {
    expect(html).toContain("the high pass");
  });

  // The playground's inline dice mirror: the receiver first runs onto the landing
  // hex, then accuracy d6, then (on a miss) the looseBall direction/distance d6s,
  // then one d6 per header contestant in ascending-distance / id order — the same
  // draw sequence the reducer makes.
  function inlineOutcome(
    c: HighPassCase,
    receiverId: string | null,
    target: Cube,
    seed: number,
  ): { arrival: string; winner: string | null } {
    const { state, carrierId } = stateFor(c);
    const carrier = state.pieces.find((p) => p.id === carrierId)!;
    const hp = carrier.attrs?.highPass ?? 3;
    // receiver runs onto the landing hex (when the route is clear)
    const positioned = state.pieces.map((p) =>
      p.id === receiverId ? { ...p, at: target } : p,
    );
    let rng = seedRng(seed);
    const [acc, r1] = rollDie(rng, 6);
    rng = r1;
    let arrival = target;
    if (acc + hp < (c.highPassAccuracyOn ?? 8)) {
      const [dir, r2] = rollDie(rng, 6);
      rng = r2;
      const [distRoll, r3] = rollDie(rng, 6);
      rng = r3;
      arrival = cubeAdd(target, cubeScale(CUBE_DIRECTIONS[dir - 1]!, distRoll));
    }
    const near = positioned
      .map((p) => ({ p, d: cubeDistance(p.at, arrival) }))
      .filter((e) => e.d <= 2)
      .sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : 1));
    const rolls = near.map(({ p, d }) => {
      const [roll, next] = rollDie(rng, 6);
      rng = next;
      const heading = c.pieces[Number(p.id.slice(1))]!.heading ?? 3;
      return { id: p.id, score: roll + (d === 2 ? heading - 1 : heading) };
    });
    let winner: string | null = null;
    if (rolls.length) {
      const top = Math.max(...rolls.map((r) => r.score));
      const lead = rolls.filter((r) => r.score === top);
      if (lead.length === 1) winner = lead[0]!.id;
    }
    return { arrival: cubeKey(arrival), winner };
  }

  it("the inline dice mirror matches the reducer over many seeds", { timeout: 20000 }, () => {
    let checked = 0;
    CASES.forEach((c) => {
      const { state, carrierId } = stateFor(c);
      for (const receiver of highPassReceivers(state, carrierId)) {
        const target = highPassTargets(state, carrierId, receiver.id)[0];
        if (!target) continue;
        for (let seed = 1; seed <= 12; seed++) {
          let s: HighPassSnapshot = initHighPass(state, seed);
          s = highPassAction(s, { type: "selectPiece", pieceId: carrierId });
          s = highPassAction(s, {
            type: "selectReceiver",
            pieceId: receiver.id,
          });
          s = highPassAction(s, { type: "commit", hex: target });
          // mirror the playground: the receiver runs onto the landing hex when
          // the route is clear, every other reactor stays put.
          const canRun = reactReach(state, receiver.id, 3).some((h) =>
            cubeEquals(h, target),
          );
          if (canRun) {
            s = highPassAction(s, { type: "reactMove", hex: target });
          }
          let guard = 0;
          while (s.phase === "reacting" && guard++ < 10) {
            if (highPassView(s).reaction?.needsPiece) {
              s = highPassAction(s, { type: "reactSkip" });
            }
            s = highPassAction(s, { type: "reactSkip" });
          }
          s = highPassAction(s, { type: "advance" }); // accuracy -> flight
          guard = 0;
          while (s.phase === "flight" && guard++ < 40) {
            s = highPassAction(s, { type: "advance" });
          }
          const mirror = inlineOutcome(
            c,
            canRun ? receiver.id : null,
            target,
            seed,
          );
          expect(cubeKey(s.arrivalHex!)).toBe(mirror.arrival);
          expect(s.header!.winner).toBe(mirror.winner);
          checked++;
        }
      }
    });
    expect(checked).toBeGreaterThan(90);
  });

  it("a teammate whose whole run stays in the shadow is not selectable", () => {
    const idx = CASES.findIndex((c) => c.title.startsWith("blocked"));
    const data = bakedCases()[idx]!;
    const { state, carrierId } = stateFor(CASES[idx]!);
    expect(data.shadow).toContain(cubeKey(cube(1, -1, 0)));
    // p2 is B (behind the marker), p3 is C (off the line)
    expect(highPassReceivers(state, carrierId).map((r) => r.id)).toEqual(["p3"]);
    expect(data.receivers).toEqual(["p3"]); // B is not offered at all
    expect(data.perReceiver["p3"]!.targets.length).toBeGreaterThan(0);
    expect(highPassTargets(state, carrierId, "p2")).toEqual([]);
  });

  it("a marker that clips a teammate's run — part blue, part grey, still selectable", () => {
    const idx = CASES.findIndex((c) => c.title === "shadow clips the run");
    const data = bakedCases()[idx]!;
    const { state, carrierId } = stateFor(CASES[idx]!);
    const carrier = state.pieces.find((p) => p.id === carrierId)!;
    // B stands clear and is a legal receiver
    expect(highPassBlocked(state, carrierId, cube(5, -2, -3))).toBe(false);
    expect(data.receivers).toContain("p2");
    const rec = data.perReceiver["p2"]!;
    // its run circle is split — some legal landing hexes, some shadowed out
    expect(rec.targets.length).toBeGreaterThan(0);
    expect(rec.blocked.length).toBeGreaterThan(0);
    // the two sets are disjoint, and every blocked hex really is shadowed
    for (const k of rec.blocked) {
      expect(rec.targets).not.toContain(k);
      const [x, y, z] = k.split(",").map(Number);
      expect(highPassBlocked(state, carrierId, cube(x!, y!, z!))).toBe(true);
      expect(cubeDistance(carrier.at, cube(x!, y!, z!))).toBeGreaterThanOrEqual(4);
    }
    // every target is reachable in 3 and clear
    for (const t of highPassTargets(state, carrierId, "p2")) {
      expect(highPassBlocked(state, carrierId, t)).toBe(false);
      expect(cubeDistance(cube(5, -2, -3), t)).toBeLessThanOrEqual(3);
    }
  });

  it("every teammate in the multi-runner case is a legal receiver with targets", () => {
    const idx = CASES.findIndex((c) => c.title.startsWith("pick a runner"));
    const data = bakedCases()[idx]!;
    const { state, carrierId } = stateFor(CASES[idx]!);
    expect(data.receivers.length).toBe(3);
    for (const rid of data.receivers) {
      expect(highPassTargets(state, carrierId, rid).length).toBeGreaterThan(0);
      expect(data.perReceiver[rid]!.targets.length).toBeGreaterThan(0);
    }
  });
});
