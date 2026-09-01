import { describe, expect, it } from "vitest";
import { cube, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { rollDie, seedRng } from "../dice/dice.js";
import { influencers, type MoveActionState, type Piece } from "../move-action/move-action.js";
import {
  writePassPlayground,
  type PassCase,
} from "../test-utils/pass-playground.js";
import {
  initPassAction,
  passAction,
  passLane,
  passRangeCubes,
  passTargets,
  passThreats,
  passView,
} from "./pass-action.js";

const origin = cube(0, 0, 0);
const ring = [
  cube(1, -1, 0),
  cube(1, 0, -1),
  cube(0, 1, -1),
  cube(-1, 1, 0),
  cube(-1, 0, 1),
  cube(0, -1, 1),
];

const CASES: PassCase[] = [
  {
    title: "open pass",
    radius: 6,
    passRange: 5,
    pieces: [
      { at: origin, label: "A", team: "home", hasBall: true },
      { at: cube(0, 4, -4), label: "B", team: "home" },
    ],
  },
  {
    title: "thread it past a defender",
    radius: 6,
    passRange: 5,
    seed: 7,
    pieces: [
      { at: origin, label: "A", team: "home", hasBall: true },
      { at: cube(2, -1, -1), label: "D", team: "away" },
      { at: cube(0, 3, -3), label: "B", team: "home" },
    ],
  },
  {
    title: "into a crowd",
    radius: 6,
    passRange: 5,
    seed: 3,
    pieces: [
      { at: origin, label: "A", team: "home", hasBall: true },
      { at: cube(1, 1, -2), label: "D1", team: "away" },
      { at: cube(-2, 3, -1), label: "D2", team: "away" },
      { at: cube(0, 3, -3), label: "B1", team: "home" },
      { at: cube(3, 0, -3), label: "B2", team: "home" },
    ],
  },
  {
    title: "no lane — boxed in",
    radius: 5,
    passRange: 4,
    pieces: [
      { at: origin, label: "A", team: "home", hasBall: true },
      ...ring.map((at, i) => ({ at, label: `D${i}`, team: "away" })),
    ],
  },
];

const html = writePassPlayground(
  "passing",
  "the pass",
  "Kick the ball to a hex in range.",
  CASES,
);

interface Baked {
  size: number;
  board: string[];
  carrierAt: string;
  targets: string[];
  blocked: string[];
  lanes: Record<
    string,
    { hexes: string[]; threats: string[]; rolls: { id: string; at: string; atIndex: number }[]; receiver: string | null }
  >;
  interceptOn: number;
  interceptDie: number;
  seed: number;
}

function bakedCases(): Baked[] {
  const m = html.match(/var CASES = (\[[\s\S]*?\]);\nfunction parse/);
  if (!m) throw new Error("could not find the baked CASES manifest");
  return (JSON.parse(m[1]!) as Array<{ data: Baked }>).map((c) => c.data);
}

/** Rebuild the state the generator bakes from, for the real module to check against. */
function stateFor(c: PassCase): { state: MoveActionState; carrierId: string } {
  const pieces: Piece[] = c.pieces.map((p, i) => ({
    id: `p${i}`,
    label: p.label,
    at: p.at,
    movePoints: 0,
    team: p.team,
  }));
  const ci = Math.max(0, c.pieces.findIndex((p) => p.hasBall));
  return {
    state: {
      pieces,
      obstacles: [],
      ball: pieces[ci]!.at,
      passRange: c.passRange ?? 4,
      interceptOn: c.interceptOn ?? 6,
      interceptDie: 6,
    },
    carrierId: `p${ci}`,
  };
}

const keys = (hexes: Iterable<Cube>) => new Set([...hexes].map(cubeKey));

describe("passing playground page", () => {
  it("puts every case on the one page", () => {
    CASES.forEach((c, i) => {
      expect(html).toContain(`id="case-${i}"`);
      expect(html).toContain(`<h2>${c.title}</h2>`);
    });
    expect(html).toContain('href="../../index.html"');
    expect(html).toContain('class="reset"');
    expect(html).toContain('class="shuffle"');
  });

  it("bakes exactly the module's pass targets and shadow", () => {
    bakedCases().forEach((data, i) => {
      const { state, carrierId } = stateFor(CASES[i]!);
      expect(new Set(data.targets)).toEqual(keys(passTargets(state, carrierId)));
      const range = keys(passRangeCubes(state, carrierId));
      const expectedBlocked = [...range].filter((k) => !data.targets.includes(k));
      expect(new Set(data.blocked)).toEqual(new Set(expectedBlocked));
    });
  });

  it("bakes each lane and its interceptors from the module", () => {
    bakedCases().forEach((data, i) => {
      const { state, carrierId } = stateFor(CASES[i]!);
      for (const tk of data.targets) {
        const [x, y, z] = tk.split(",").map(Number);
        const target = cube(x!, y!, z!);
        expect(data.lanes[tk]!.hexes).toEqual(
          passLane(state, carrierId, target).map(cubeKey),
        );
        expect(new Set(data.lanes[tk]!.threats)).toEqual(
          keys(passThreats(state, carrierId, target)),
        );
        // rolls carry every opponent that flanks a flight hex, once
        const laneHexes = passLane(state, carrierId, target);
        const carrierTeam = state.pieces.find((p) => p.id === carrierId)!.team;
        const expected = new Set<string>();
        for (let h = 1; h < laneHexes.length; h++) {
          for (const foe of influencers(state, laneHexes[h]!, carrierTeam)) {
            expected.add(String(foe.label));
          }
        }
        expect(new Set(data.lanes[tk]!.rolls.map((r) => r.id))).toEqual(expected);
      }
    });
  });

  it("the boxed-in carrier has no legal target", () => {
    const boxed = bakedCases()[3]!;
    expect(boxed.targets).toEqual([]);
  });

  it("the inline interception roll matches the real reducer over many seeds", () => {
    const ci = 2; // "into a crowd"
    const data = bakedCases()[ci]!;
    const { state, carrierId } = stateFor(CASES[ci]!);
    const risky = data.targets
      .filter((k) => data.lanes[k]!.rolls.length > 0)
      .slice(0, 12);
    expect(risky.length).toBeGreaterThan(0);

    let checked = 0;
    for (const tk of risky) {
      const [x, y, z] = tk.split(",").map(Number);
      const target = cube(x!, y!, z!);
      const rolls = data.lanes[tk]!.rolls;

      for (let seed = 1; seed <= 25; seed++) {
        // real reducer
        let snap = initPassAction(state, seed);
        snap = passAction(snap, { type: "selectPiece", pieceId: carrierId });
        snap = passAction(snap, { type: "commit", hex: target });
        let g = 0;
        while (snap.phase === "passing" && g++ < 30) {
          snap = passAction(snap, { type: "advance" });
        }
        const v = passView(snap);
        const real = v.intercept
          ? `by:${state.pieces.find((p) => p.id === v.intercept!.by)!.label}`
          : snap.phase;

        // inline mirror: same baked rolls, in order, rng advances for every roll
        let rng = seedRng(seed);
        let picked: string | null = null;
        for (const r of rolls) {
          const [roll, next] = rollDie(rng, data.interceptDie);
          rng = next;
          if (picked === null && roll >= data.interceptOn) picked = r.id;
        }
        const mirror = picked
          ? `by:${picked}`
          : data.lanes[tk]!.receiver
            ? "received"
            : "loose";

        expect(mirror).toBe(real);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("registers the action on the landing nav", () => {
    expect(html).toContain("the pass");
  });
});
