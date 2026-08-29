import { describe, expect, it } from "vitest";
import { cube } from "../coordinates/coordinates.js";
import { DEFAULT_HEX_SIZE } from "../layout/layout.js";
import {
  writePiecePlayground,
  type PieceCase,
} from "../test-utils/piece-playground.js";
import { movePiece, type MoveMode } from "./move-piece.js";

const origin = cube(0, 0, 0);

/** A short run of hexes across the y = 0 row, a gap to hop. */
const eastRowPit = [cube(-1, 0, 1), origin, cube(1, 0, -1), cube(2, 0, -2)];

const CASES: PieceCase[] = [
  {
    title: "one step — ground",
    radius: 4,
    pieces: [{ kind: "player", at: cube(-2, 2, 0), label: 1 }],
  },
  {
    title: "the long slide — same speed",
    radius: 6,
    pieces: [{ kind: "player", at: cube(-5, 3, 2), label: 1 }],
  },
  {
    title: "near or far, one speed",
    radius: 6,
    speed: 5,
    pieces: [{ kind: "player", at: origin, label: 2 }],
  },
  {
    title: "rolling the ball",
    radius: 5,
    pieces: [{ kind: "ball", at: cube(-3, 1, 2) }],
  },
  {
    title: "hop the pit",
    radius: 5,
    defaultMode: "jump",
    pit: eastRowPit,
    pieces: [{ kind: "player", at: cube(-3, 0, 3), label: 4 }],
  },
  {
    title: "the long jump",
    radius: 7,
    defaultMode: "jump",
    pieces: [{ kind: "player", at: cube(-6, 3, 3), label: 5 }],
  },
  {
    title: "ball under, player over",
    radius: 6,
    pit: eastRowPit,
    pieces: [
      { kind: "ball", at: cube(-4, 1, 3), mode: "ground" },
      { kind: "player", at: cube(-4, 1, 3), mode: "jump", label: 9, color: "#2b7" },
    ],
  },
];

interface Baked {
  size: number;
  speed: number;
  falloff: number;
  minMs: number;
  jumpPeak: number;
  defaultMode: MoveMode;
  board: string[];
  pit: string[];
  pieces: Array<{ kind: string; at: string; mode: MoveMode | null }>;
}

const html = writePiecePlayground(
  "move-piece",
  "piece animation",
  "Sliding and jumping a piece from hex to hex.",
  CASES,
);

/** The `CASES` manifest baked into the page — the source of truth the live JS runs on. */
function bakedCases(): Baked[] {
  const m = html.match(/var CASES = (\[[\s\S]*?\]);\nfunction keyParts/);
  if (!m) throw new Error("could not find the baked CASES manifest");
  return (JSON.parse(m[1]!) as Array<{ data: Baked }>).map((c) => c.data);
}

/** Re-implementation of `planMove` from the inline script, to catch drift. */
function mirror(fromK: string, toK: string, mode: MoveMode, d: Baked) {
  const parts = (k: string): number[] => k.split(",").map(Number);
  const toPixel = (k: string) => {
    const p = parts(k);
    return {
      x: d.size * Math.sqrt(3) * (p[0]! + p[2]! / 2),
      y: d.size * 1.5 * p[2]!,
    };
  };
  const p = parts(fromK);
  const q = parts(toK);
  const hexes =
    (Math.abs(p[0]! - q[0]!) +
      Math.abs(p[1]! - q[1]!) +
      Math.abs(p[2]! - q[2]!)) /
    2;
  const duration =
    hexes > 0
      ? Math.max((Math.pow(hexes, d.falloff) / d.speed) * 1000, d.minMs)
      : mode === "jump"
        ? d.minMs
        : 0;
  return { from: toPixel(fromK), to: toPixel(toK), hexes, duration };
}

const toCube = (k: string): ReturnType<typeof cube> => {
  const [x, y, z] = k.split(",").map(Number);
  return cube(x!, y!, z!);
};

describe("move-piece playground page", () => {
  it("puts every case on the one page", () => {
    CASES.forEach((c, i) => {
      expect(html).toContain(`id="case-${i}"`);
      expect(html).toContain(`<h2>${c.title}</h2>`);
    });
    expect(html).toContain('href="../../index.html"');
  });

  it("renders one piece group per placement, with a striped ball", () => {
    const placements = CASES.reduce((n, c) => n + c.pieces.length, 0);
    expect((html.match(/class="piece"/g) ?? []).length).toBe(placements);
    expect(html).toContain('class="marker ball"');
    expect(html).toContain("ball-stripe-");
  });

  it("offers a ground / jump toggle on every case, active = the case default", () => {
    expect((html.match(/data-mode="ground"/g) ?? []).length).toBe(CASES.length);
    expect((html.match(/data-mode="jump"/g) ?? []).length).toBe(CASES.length);
    const jumpDefaults = CASES.filter((c) => c.defaultMode === "jump").length;
    expect(
      (html.match(/class="mode active" type="button" data-mode="jump"/g) ?? [])
        .length,
    ).toBe(jumpDefaults);
  });

  it("the inline mirror agrees with movePiece for every board", () => {
    for (const d of bakedCases()) {
      const start = d.pieces[0]!.at;
      const target = d.board[d.board.length - 1]!; // a far corner
      for (const mode of ["ground", "jump"] as MoveMode[]) {
        const mir = mirror(start, target, mode, d);
        const plan = movePiece(toCube(start), toCube(target), {
          mode,
          size: d.size,
          speed: d.speed,
          falloff: d.falloff,
          minMs: d.minMs,
          jumpPeak: d.jumpPeak,
        });
        expect(plan.durationMs).toBeCloseTo(mir.duration);
        expect(plan.hexes).toBe(mir.hexes);
        expect(plan.from.x).toBeCloseTo(mir.from.x);
        expect(plan.from.y).toBeCloseTo(mir.from.y);
        expect(plan.to.x).toBeCloseTo(mir.to.x);
        expect(plan.to.y).toBeCloseTo(mir.to.y);
        expect(plan.at(0.5).scale).toBeCloseTo(mode === "jump" ? d.jumpPeak : 1);
      }
    }
  });

  it("bakes the default hex size, falloff, and per-case speed", () => {
    const baked = bakedCases();
    expect(baked.every((d) => d.size === DEFAULT_HEX_SIZE)).toBe(true);
    expect(baked.every((d) => d.falloff === 0.65)).toBe(true);
    expect(baked[2]!.speed).toBe(5);
    expect(baked[0]!.speed).toBe(6);
  });

  it("a farther target lasts longer, but sub-linearly (it accelerates)", () => {
    const near = movePiece(origin, cube(1, -1, 0), { minMs: 0 });
    const far = movePiece(origin, cube(4, -4, 0), { minMs: 0 });
    const ratio = far.durationMs / near.durationMs;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeCloseTo(Math.pow(4, 0.65));
    expect(ratio).toBeLessThan(4);
  });
});
