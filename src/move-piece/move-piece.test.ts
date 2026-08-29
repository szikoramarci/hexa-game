import { describe, expect, it } from "vitest";
import { cube } from "../coordinates/coordinates.js";
import { cubeToPixel } from "../layout/layout.js";
import { moveKeyframes, movePiece } from "./move-piece.js";

const origin = cube(0, 0, 0);

describe("movePiece · duration", () => {
  it("grows sub-linearly with distance (longer moves accelerate)", () => {
    const near = movePiece(origin, cube(1, -1, 0), { speed: 4, minMs: 0 });
    const far = movePiece(origin, cube(5, -5, 0), { speed: 4, minMs: 0 });
    expect(near.hexes).toBe(1);
    expect(far.hexes).toBe(5);
    // hexes ** 0.65, not hexes ** 1 — so well under 5x.
    expect(far.durationMs).toBeCloseTo(near.durationMs * Math.pow(5, 0.65));
    expect(far.durationMs).toBeLessThan(near.durationMs * 5);
  });

  it("falloff: 1 restores a strictly constant on-screen speed", () => {
    const near = movePiece(origin, cube(1, -1, 0), { falloff: 1, minMs: 0 });
    const far = movePiece(origin, cube(6, -6, 0), { falloff: 1, minMs: 0 });
    const pxPerMs = (p: ReturnType<typeof movePiece>): number =>
      Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y) / p.durationMs;
    expect(pxPerMs(far)).toBeCloseTo(pxPerMs(near));
    expect(far.durationMs).toBeCloseTo(near.durationMs * 6);
  });

  it("with the default falloff a far move covers more px per ms than a step", () => {
    const near = movePiece(origin, cube(1, -1, 0), { minMs: 0 });
    const far = movePiece(origin, cube(6, -6, 0), { minMs: 0 });
    const pxPerMs = (p: ReturnType<typeof movePiece>): number =>
      Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y) / p.durationMs;
    expect(pxPerMs(far)).toBeGreaterThan(pxPerMs(near) * 1.5);
  });

  it("floors a real move at minMs, but an in-place ground move is instant", () => {
    const tiny = movePiece(origin, cube(1, -1, 0), { speed: 1000, minMs: 120 });
    expect(tiny.durationMs).toBe(120);

    const still = movePiece(origin, origin);
    expect(still.durationMs).toBe(0);
    expect(still.from).toEqual(still.to);

    const hopInPlace = movePiece(origin, origin, { mode: "jump", minMs: 80 });
    expect(hopInPlace.durationMs).toBe(80);
  });
});

describe("movePiece · position", () => {
  it("from / to are the hex pixel centres and follow size", () => {
    const end = cube(2, -1, -1);
    const plan = movePiece(origin, end, { size: 40 });
    expect(plan.from).toEqual(cubeToPixel(origin, 40));
    expect(plan.to).toEqual(cubeToPixel(end, 40));
  });

  it("at() lerps the chord and clamps t to [0, 1]", () => {
    const end = cube(3, -3, 0);
    const plan = movePiece(origin, end);
    expect(plan.at(0).x).toBeCloseTo(plan.from.x);
    expect(plan.at(0).y).toBeCloseTo(plan.from.y);
    expect(plan.at(1).x).toBeCloseTo(plan.to.x);
    expect(plan.at(1).y).toBeCloseTo(plan.to.y);
    const mid = plan.at(0.5);
    expect(mid.x).toBeCloseTo((plan.from.x + plan.to.x) / 2);
    expect(mid.y).toBeCloseTo((plan.from.y + plan.to.y) / 2);
    expect(plan.at(-1)).toEqual(plan.at(0));
    expect(plan.at(2)).toEqual(plan.at(1));
  });
});

describe("movePiece · scale", () => {
  it("ground stays at scale 1 throughout", () => {
    const plan = movePiece(origin, cube(4, -4, 0));
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(plan.at(t).scale).toBe(1);
    }
  });

  it("jump humps to jumpPeak at the apex, symmetric, back to 1 on the ends", () => {
    const plan = movePiece(origin, cube(4, -4, 0), { mode: "jump", jumpPeak: 1.8 });
    expect(plan.at(0).scale).toBeCloseTo(1);
    expect(plan.at(1).scale).toBeCloseTo(1);
    expect(plan.at(0.5).scale).toBeCloseTo(1.8);
    expect(plan.at(0.25).scale).toBeCloseTo(plan.at(0.75).scale);
    expect(plan.at(0.25).scale).toBeGreaterThan(1);
    expect(plan.at(0.25).scale).toBeLessThan(1.8);
  });

  it("respects the default jumpPeak", () => {
    const plan = movePiece(origin, cube(2, -2, 0), { mode: "jump" });
    expect(plan.at(0.5).scale).toBeCloseTo(1.6);
  });
});

describe("moveKeyframes", () => {
  it("emits steps + 1 frames with monotonic offsets from 0 to 1", () => {
    const plan = movePiece(origin, cube(3, -3, 0), { mode: "jump" });
    const kf = moveKeyframes(plan, 12);
    expect(kf).toHaveLength(13);
    expect(kf[0]!.offset).toBe(0);
    expect(kf[12]!.offset).toBe(1);
    for (let i = 1; i < kf.length; i++) {
      expect(kf[i]!.offset).toBeGreaterThan(kf[i - 1]!.offset);
    }
  });

  it("transforms are CSS-valid translate + scale with 2-decimal numbers", () => {
    const plan = movePiece(origin, cube(2, -1, -1), { mode: "jump" });
    for (const frame of moveKeyframes(plan, 8)) {
      expect(frame.transform).toMatch(
        /^translate\(-?\d+\.\d{2}px, -?\d+\.\d{2}px\) scale\(-?\d+\.\d{2}\)$/,
      );
    }
  });

  it("first and last frames sit on the endpoints at scale 1", () => {
    const plan = movePiece(origin, cube(4, -2, -2), { mode: "jump" });
    const kf = moveKeyframes(plan, 10);
    expect(kf[0]!.transform).toBe(
      `translate(${plan.from.x.toFixed(2)}px, ${plan.from.y.toFixed(2)}px) scale(1.00)`,
    );
    expect(kf.at(-1)!.transform).toBe(
      `translate(${plan.to.x.toFixed(2)}px, ${plan.to.y.toFixed(2)}px) scale(1.00)`,
    );
  });

  it("clamps steps to at least 1", () => {
    const plan = movePiece(origin, cube(1, -1, 0));
    expect(moveKeyframes(plan, 0)).toHaveLength(2);
    expect(moveKeyframes(plan, -5)).toHaveLength(2);
  });
});

describe("movePiece · purity", () => {
  it("does not mutate its inputs and is deterministic", () => {
    const start = cube(1, -2, 1);
    const end = cube(-2, 1, 1);
    const a = movePiece(start, end, { mode: "jump" });
    const b = movePiece(start, end, { mode: "jump" });
    expect(start).toEqual(cube(1, -2, 1));
    expect(end).toEqual(cube(-2, 1, 1));
    expect(moveKeyframes(a)).toEqual(moveKeyframes(b));
    expect(a.durationMs).toBe(b.durationMs);
  });
});
