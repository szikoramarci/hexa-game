import { describe, it } from "vitest";
import { cube, type Cube } from "../coordinates/coordinates.js";
import type { MoveActionState, Piece } from "../move-action/move-action.js";
import type { Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";
import {
  passArrow,
  passLane,
  passTargets,
  passThreats,
} from "./pass-action.js";

const origin = cube(0, 0, 0);
const draw = (name: string, s: Scenario) => writeScenario("pass-action", name, s);

const carrier = (at: Cube): Piece => ({ id: "p1", label: 1, at, movePoints: 3, team: "home" });
const foe = (id: string, at: Cube): Piece => ({ id, label: id, at, movePoints: 3, team: "away" });
const mate = (id: string, at: Cube): Piece => ({ id, label: id, at, movePoints: 3, team: "home" });

function st(pieces: Piece[], passRange: number): MoveActionState {
  return { pieces, obstacles: [], ball: pieces[0]!.at, passRange };
}

describe("pass-action · scenarios", () => {
  it("range — the full rounded kick disc", () => {
    const s = st([carrier(origin)], 4);
    draw("range", {
      radius: 6,
      title: "pass range — pixelRangeCubes(carrier, 4), no shadows",
      player: [origin],
      reachable: passTargets(s, "p1"),
    });
  });

  it("shadow — hexes behind a defender drop out", () => {
    const s = st([carrier(origin), foe("d1", cube(2, -2, 0))], 5);
    draw("shadow", {
      radius: 7,
      title: "shadow — the wedge behind d1 is gone from the range (d1 = dark)",
      player: [origin],
      obstacle: [cube(2, -2, 0)],
      reachable: passTargets(s, "p1"),
    });
  });

  it("through-teammate — a teammate on the lane blocks nothing", () => {
    const s = st([carrier(origin), mate("m1", cube(2, -2, 0))], 5);
    draw("through-teammate", {
      radius: 7,
      title: "through a teammate — range unbroken (m1 = green, on the lane)",
      player: [origin],
      goal: [cube(2, -2, 0)],
      reachable: passTargets(s, "p1"),
    });
  });

  it("lane — a chosen target and its supercover lane", () => {
    const s = st([carrier(origin)], 6);
    const target = cube(4, -1, -3);
    const lane = passLane(s, "p1", target);
    draw("lane", {
      radius: 6,
      title: "lane — lineCoverageCubes(carrier, target) + the pass arrow",
      player: [origin],
      goal: [target],
      path: lane,
      lines: [[origin, target]],
      arrows: [passArrow(lane)!],
    });
  });

  it("threats — a lane skimming two defenders", () => {
    const target = cube(0, 5, -5);
    const s = st(
      [carrier(origin), foe("d1", cube(1, 2, -3)), foe("d2", cube(-1, 4, -3))],
      6,
    );
    const lane = passLane(s, "p1", target);
    draw("threats", {
      radius: 7,
      title: "threats — flight hexes a defender flanks are marked; arrow reddened",
      player: [origin],
      obstacle: [cube(1, 2, -3), cube(-1, 4, -3)],
      goal: passThreats(s, "p1", target),
      path: lane,
      arrows: [passArrow(lane, { color: "#d33" })!],
    });
  });

  it("crowd — targets, shadow and threats together", () => {
    const s = st(
      [
        carrier(origin),
        foe("d1", cube(1, -1, 0)),
        foe("d2", cube(-1, 2, -1)),
        mate("m1", cube(0, 3, -3)),
        mate("m2", cube(3, 0, -3)),
      ],
      5,
    );
    draw("crowd", {
      radius: 7,
      title: "crowd — 2 defenders (dark) box the passing lanes; teammates green",
      player: [origin],
      obstacle: [cube(1, -1, 0), cube(-1, 2, -1)],
      goal: [cube(0, 3, -3), cube(3, 0, -3)],
      reachable: passTargets(s, "p1"),
    });
  });

  it("offset — a non-origin carrier", () => {
    const at = cube(-2, -1, 3);
    const s = st([carrier(at), foe("d1", cube(0, -2, 2))], 5);
    draw("offset", {
      radius: 8,
      title: "off-centre carrier, one defender casting a shadow",
      player: [at],
      obstacle: [cube(0, -2, 2)],
      reachable: passTargets(s, "p1"),
    });
  });
});
