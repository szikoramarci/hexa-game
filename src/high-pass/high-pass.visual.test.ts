import { describe, it } from "vitest";
import { cube, cubeEquals, type Cube } from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";
import { reachableCubes } from "../movement/movement.js";
import type { MoveActionState, Piece } from "../move-action/move-action.js";
import type { Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";
import { looseBall } from "../loose-ball/loose-ball.js";
import {
  highPassArrow,
  highPassLandingZone,
  highPassRangeCubes,
  highPassShadow,
  highPassTargets,
} from "./high-pass.js";

const O = cube(0, 0, 0);
const draw = (name: string, s: Scenario) => writeScenario("high-pass", name, s);

const carrier = (at: Cube): Piece => ({
  id: "p1",
  label: 1,
  at,
  movePoints: 3,
  team: "home",
});
const foe = (id: string, at: Cube, over: Partial<Piece> = {}): Piece => ({
  id,
  label: id,
  at,
  movePoints: 3,
  team: "away",
  ...over,
});
const mate = (id: string, at: Cube): Piece => ({
  id,
  label: id,
  at,
  movePoints: 3,
  team: "home",
});

function st(pieces: Piece[], over: Partial<MoveActionState> = {}): MoveActionState {
  return { pieces, obstacles: [], ball: pieces[0]!.at, highPassRange: 8, ...over };
}

/** The hexes exactly `d` away from `centre`, within a working radius. */
const ring = (centre: Cube, d: number): Cube[] =>
  reachableCubes(centre, d).filter((h) => cubeDistance(centre, h) === d);

describe("high-pass · scenarios", () => {
  it("range — the long disc with the inner three rings cut out", () => {
    const s = st([carrier(O)]);
    draw("range", {
      radius: 10,
      title: "high-pass range — pixelRangeCubes(carrier, 8), inner 3 rings removed",
      player: [O],
      reachable: highPassRangeCubes(s, "p1"),
    });
  });

  it("shadow — an adjacent marker blocks the wedge behind it", () => {
    const s = st([carrier(O), foe("d1", cube(1, -1, 0)), foe("d2", cube(3, 0, -3))]);
    draw("shadow", {
      radius: 10,
      title:
        "shadow — d1 (adjacent, dark) removes the wedge behind it; d2 (2 away) does not",
      player: [O],
      obstacle: [cube(1, -1, 0), cube(3, 0, -3)],
      reachable: highPassLandingZone(s, "p1"),
    });
  });

  it("receiver — the landing zone narrowed to the receiver's run circle", () => {
    const s = st([carrier(O), mate("m1", cube(6, -6, 0)), foe("d1", cube(0, 1, -1))]);
    draw("receiver", {
      radius: 10,
      title: "receiver — landing zone ∩ (≤ 3 hexes of m1, green); d1 shadows the south",
      player: [O],
      goal: [cube(6, -6, 0)],
      obstacle: [cube(0, 1, -1)],
      reachable: highPassTargets(s, "p1", "m1"),
    });
  });

  it("loft — a chosen landing hex, the jump arc + the run circle", () => {
    const s = st([carrier(O), mate("m1", cube(6, -6, 0))]);
    const target = cube(5, -4, -1);
    draw("loft", {
      radius: 9,
      title: "loft — highPassArrow(carrier, target) jump arc; m1's 3-hex run circle",
      player: [O],
      goal: [target],
      reachable: ring(cube(6, -6, 0), 1).concat(
        ring(cube(6, -6, 0), 2),
        ring(cube(6, -6, 0), 3),
      ),
      arrows: [highPassArrow(O, target)!],
    });
  });

  it("box — landing in the penalty area, the keeper challenge radius", () => {
    const target = cube(6, -6, 0);
    draw("box", {
      radius: 10,
      title: "box — loft into the area; keeper (dark) within 5 hexes gets the 4-hex move",
      player: [O],
      goal: [target],
      obstacle: [cube(8, -6, -2)],
      reachable: reachableCubes(cube(8, -6, -2), 5).filter(
        (h) => cubeDistance(cube(8, -6, -2), h) === 5,
      ),
      arrows: [highPassArrow(O, target)!],
    });
  });

  it("header — the full (0/1) and reduced (2) contestant rings", () => {
    const arrival = cube(6, -6, 0);
    draw("header", {
      radius: 10,
      title: "header — ring 0/1 contest at full attr; ring 2 (goal) at attr − 1",
      player: [O],
      goal: ring(arrival, 2),
      reachable: [arrival, ...ring(arrival, 1)],
    });
  });

  it("scatter — an inaccurate loft rolls off the target", () => {
    const target = cube(6, -6, 0);
    const roll = looseBall(1234, target, []);
    draw("scatter", {
      radius: 11,
      title: "scatter — looseBall(target) route to rest; the header rings move with it",
      player: [O],
      goal: [roll.rest],
      path: roll.route,
      reachable: [roll.rest, ...ring(roll.rest, 1), ...ring(roll.rest, 2)].filter(
        (h) => !cubeEquals(h, roll.rest),
      ),
      arrows: [highPassArrow(O, target, { color: "#d33", dash: "dashed" })!],
    });
  });
});
