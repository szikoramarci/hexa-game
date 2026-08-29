import { describe, it } from "vitest";
import { cube, type Cube } from "../coordinates/coordinates.js";
import type { ArrowSpec, Scenario } from "../test-utils/scenario.js";
import { writeScenario } from "../test-utils/write-scenario.js";

/** A horizontal run of `count` hexes on cube row `z`, starting at `xFrom`. */
const row = (z: number, xFrom: number, count: number): Cube[] =>
  Array.from({ length: count }, (_, i) =>
    cube(xFrom + i, -(xFrom + i) - z, z),
  );

const draw = (name: string, s: Scenario) => writeScenario("arrow", name, s);

/** First and last hex of an arrow, for the player / goal markers. */
const ends = (specs: ArrowSpec[]): Pick<Scenario, "player" | "goal"> => {
  const hexes = specs.flatMap((spec) => [...spec.hexes]);
  return { player: [hexes[0]!], goal: [hexes[hexes.length - 1]!] };
};

describe("arrow · styles", () => {
  it("style sheet — thin / normal / thick / dashed, straight", () => {
    const arrows: ArrowSpec[] = [
      { hexes: row(-3, -2, 5), weight: "thin", color: "#2980b9" },
      { hexes: row(-1, -2, 5), weight: "normal", color: "#8e44ad" },
      { hexes: row(1, -2, 5), weight: "thick", color: "#c0392b" },
      { hexes: row(3, -2, 5), weight: "normal", dash: "dashed", color: "#16a085" },
    ];
    draw("styles", {
      radius: 6,
      title: "arrow styles — thin · normal · thick · dashed",
      arrows,
      ...ends(arrows),
    });
  });

  const zigzag = [
    cube(0, 0, 0),
    cube(1, -1, 0),
    cube(1, 0, -1),
    cube(2, -1, -1),
    cube(2, 0, -2),
  ];

  it("straight through five hexes", () => {
    const arrows: ArrowSpec[] = [{ hexes: zigzag, shape: "straight", color: "#c0392b" }];
    draw("straight-multi", {
      radius: 4,
      title: "straight — every centre is a corner",
      arrows,
      ...ends(arrows),
    });
  });

  it("curved through the same five hexes", () => {
    const arrows: ArrowSpec[] = [{ hexes: zigzag, shape: "curved", color: "#8e44ad" }];
    draw("curved-multi", {
      radius: 4,
      title: "curved — a Catmull-Rom spline through the centres",
      arrows,
      ...ends(arrows),
    });
  });

  it("thick dashed curved — a short emphatic arrow", () => {
    const hexes = [cube(0, 1, -1), cube(1, 0, -1), cube(1, -1, 0)];
    const arrows: ArrowSpec[] = [
      { hexes, shape: "curved", weight: "thick", dash: "dashed", color: "#d35400" },
    ];
    draw("thick-dashed", {
      radius: 3,
      title: "thick · dashed · curved",
      arrows,
      ...ends(arrows),
    });
  });

  it("sharp turn — straight vs curved, same hexes", () => {
    const hexes = [
      cube(-2, 2, 0),
      cube(-1, 1, 0),
      cube(0, 0, 0),
      cube(0, -1, 1),
      cube(0, -2, 2),
    ];
    const arrows: ArrowSpec[] = [
      { hexes, shape: "straight", color: "#c0392b" },
      { hexes, shape: "curved", color: "#2980b9" },
    ];
    draw("turn", {
      radius: 4,
      title: "right-angle turn — straight (red) vs curved (blue)",
      arrows,
      ...ends(arrows),
    });
  });

  it("jump vs walk — same endpoints, no middle hexes", () => {
    const start = cube(-5, 2, 3);
    const end = cube(5, -2, -3);
    const arrows: ArrowSpec[] = [
      { hexes: [start, end], shape: "straight", color: "#c0392b" },
      { hexes: [start, end], shape: "curved", color: "#2980b9" },
    ];
    draw("jump", {
      radius: 6,
      title: "walk on the board (red) vs jump over the gap (blue)",
      arrows,
      ...ends(arrows),
    });
  });

  it("jump over a wall — the arc clears obstacles the walk would hit", () => {
    const start = cube(-4, 0, 4);
    const end = cube(4, 0, -4);
    const wall = [cube(-1, 0, 1), cube(0, 0, 0), cube(1, 0, -1)];
    const arrows: ArrowSpec[] = [
      { hexes: [start, end], shape: "curved", weight: "thick", color: "#2980b9" },
    ];
    draw("jump-over-wall", {
      radius: 5,
      title: "jump — start on the ground, arc over the wall, land",
      obstacle: wall,
      arrows,
      player: [start],
      goal: [end],
    });
  });

  it("hop height scales with distance — short vs long jump", () => {
    const short: [Cube, Cube] = [cube(-4, 4, 0), cube(-1, 1, 0)];
    const long: [Cube, Cube] = [cube(-4, -1, 5), cube(5, -4, -1)];
    const arrows: ArrowSpec[] = [
      { hexes: short, shape: "curved", color: "#8e44ad" },
      { hexes: long, shape: "curved", color: "#16a085" },
    ];
    draw("jump-scale", {
      radius: 6,
      title: "short hop (purple) vs long jump (teal) — apex rises with distance",
      arrows,
      player: [short[0], long[0]],
      goal: [short[1], long[1]],
    });
  });

  it("long 4-corner route — dashed straight vs solid curved", () => {
    // Six waypoints -> five segments -> four interior corners, spanning most of
    // a radius-8 board: E×4, then NE, NW, E, SE runs.
    const waypoints = [
      cube(-6, 3, 3),
      cube(-2, -1, 3),
      cube(1, -1, 0),
      cube(1, 2, -3),
      cube(4, -1, -3),
      cube(4, -4, 0),
    ];
    const arrows: ArrowSpec[] = [
      { hexes: waypoints, shape: "straight", weight: "normal", dash: "dashed", color: "#c0392b" },
      { hexes: waypoints, shape: "curved", weight: "thin", color: "#2980b9" },
    ];
    draw("route-4-corners", {
      radius: 8,
      title: "4-corner route across the board — dashed straight (red) vs curved (blue)",
      arrows,
      ...ends(arrows),
    });
  });

  it("off-centre board region", () => {
    const hexes = [
      cube(4, -2, -2),
      cube(5, -3, -2),
      cube(6, -4, -2),
      cube(6, -3, -3),
    ];
    const arrows: ArrowSpec[] = [{ hexes, shape: "curved", weight: "thick", color: "#16a085" }];
    draw("offset", {
      radius: 8,
      title: "curved arrow across a non-origin region",
      arrows,
      ...ends(arrows),
    });
  });
});
