import { describe, expect, it } from "vitest";
import { cube, type Cube } from "../coordinates/coordinates.js";
import { hexArrow } from "./arrow.js";

const origin = cube(0, 0, 0);
const east = cube(1, -1, 0);
const east2 = cube(2, -2, 0);

/** Pointy-top unit-size pixel centre, `size` scaled. */
const px = (c: Cube, size = 26) => ({
  x: size * Math.sqrt(3) * (c.x + c.z / 2),
  y: size * 1.5 * c.z,
});

/** First `points="a,b c,d ..."` list in the string, as number pairs. */
function polygonPoints(svg: string): Array<[number, number]> {
  const m = svg.match(/<polygon points="([^"]+)"/);
  if (!m) throw new Error("no polygon");
  return m[1]!.split(" ").map((pair) => {
    const [a, b] = pair.split(",").map(Number);
    return [a!, b!];
  });
}

const strokeWidth = (svg: string) =>
  Number(svg.match(/stroke-width="([\d.]+)"/)![1]);

describe("hexArrow", () => {
  it("throws with fewer than two distinct hexes", () => {
    expect(() => hexArrow([])).toThrow(RangeError);
    expect(() => hexArrow([origin])).toThrow(RangeError);
    expect(() => hexArrow([origin, origin, origin])).toThrow(RangeError);
  });

  it("emits one group, one path and one arrowhead", () => {
    const svg = hexArrow([origin, east]);
    expect(svg.match(/<g /g)).toHaveLength(1);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.match(/<polygon /g)).toHaveLength(1);
  });

  it("starts the path at the first hex centre", () => {
    const svg = hexArrow([origin, east2]);
    const start = px(origin);
    expect(svg).toContain(`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`);
  });

  it("puts the arrowhead tip exactly on the last hex centre", () => {
    const svg = hexArrow([origin, east, east2]);
    const tip = polygonPoints(svg)[0]!;
    const want = px(east2);
    expect(tip[0]).toBeCloseTo(want.x, 2);
    expect(tip[1]).toBeCloseTo(want.y, 2);
  });

  it("uses cubic segments only when curved", () => {
    expect(hexArrow([origin, east, east2], { shape: "curved" })).toContain(" C ");
    expect(hexArrow([origin, east, east2], { shape: "straight" })).not.toContain(
      " C ",
    );
  });

  // Endpoints on the x axis (py = 0), so the ground chord is at y ≈ 0 and the
  // hop shows up as strongly negative y among the path points.
  const far = cube(6, -6, 0);
  const pathYs = (svg: string): number[] =>
    svg
      .match(/ d="([^"]+)"/)![1]!
      .match(/-?\d+\.\d+/g)!
      .map(Number)
      .filter((_, i) => i % 2 === 1);

  it("draws a two-hex curved arrow as a jump: arc, ground chord, apex tick", () => {
    const svg = hexArrow([origin, far], { shape: "curved" });
    expect(svg.match(/<line /g)).toHaveLength(2);

    // The head still lands exactly on the end hex centre.
    const tip = polygonPoints(svg)[0]!;
    expect(tip[0]).toBeCloseTo(px(far).x, 2);
    expect(tip[1]).toBeCloseTo(px(far).y, 2);

    const ys = pathYs(svg);
    expect(Math.min(...ys)).toBeLessThan(-20); // rises well above the ground
    expect(Math.max(...ys)).toBeLessThan(1); // never dips below it

    const tick = svg.match(/<line [^>]*stroke-dasharray[^>]*>/)![0];
    expect(Number(tick.match(/x1="([-\d.]+)"/)![1])).toBeCloseTo(
      Number(tick.match(/x2="([-\d.]+)"/)![1]),
      2,
    );
  });

  it("bow sets the hop height; 0 or a waypoint turns the jump off", () => {
    const apexY = (style: object) => Math.min(...pathYs(hexArrow([origin, far], style)));
    expect(apexY({ shape: "curved", bow: 0.4 })).toBeLessThan(
      apexY({ shape: "curved", bow: 0.15 }),
    );

    // bow 0 -> a plain line, no jump chrome.
    expect(hexArrow([origin, far], { shape: "curved", bow: 0 })).not.toContain("<line ");
    // 3+ hexes -> a route across the board, not a jump.
    expect(
      hexArrow([origin, east, east2], { shape: "curved", bow: 0.5 }),
    ).not.toContain("<line ");
    expect(hexArrow([origin, east, east2], { shape: "curved", bow: 0.5 })).toBe(
      hexArrow([origin, east, east2], { shape: "curved", bow: 0 }),
    );
  });

  it("scales stroke width by weight and by size", () => {
    const thin = strokeWidth(hexArrow([origin, east2], { weight: "thin" }));
    const normal = strokeWidth(hexArrow([origin, east2], { weight: "normal" }));
    const thick = strokeWidth(hexArrow([origin, east2], { weight: "thick" }));
    expect(thin).toBeLessThan(normal);
    expect(normal).toBeLessThan(thick);

    const big = strokeWidth(hexArrow([origin, east2], { weight: "normal", size: 52 }));
    expect(big).toBeCloseTo(normal * 2, 5);
  });

  it("dashes the shaft but never the head", () => {
    const svg = hexArrow([origin, east2], { dash: "dashed" });
    const path = svg.match(/<path [^>]+>/)![0];
    const polygon = svg.match(/<polygon [^>]+>/)![0];
    expect(path).toContain("stroke-dasharray");
    expect(polygon).not.toContain("stroke-dasharray");
    expect(hexArrow([origin, east2], { dash: "solid" })).not.toContain(
      "stroke-dasharray",
    );
  });

  it("propagates colour to the stroke and the head fill", () => {
    const svg = hexArrow([origin, east2], { color: "#123456" });
    expect(svg).toContain('stroke="#123456"');
    expect(svg).toContain('fill="#123456"');
  });

  it("draws one path vertex per hex when straight", () => {
    const line = [origin, east, east2, cube(3, -3, 0), cube(4, -4, 0)];
    const svg = hexArrow(line, { shape: "straight" });
    const d = svg.match(/ d="([^"]+)"/)![1]!;
    const verts = d.match(/[ML]/g)!.length;
    expect(verts).toBe(line.length);
  });

  it("is deterministic", () => {
    const a = hexArrow([origin, east, east2], { shape: "curved", weight: "thick" });
    const b = hexArrow([origin, east, east2], { shape: "curved", weight: "thick" });
    expect(a).toBe(b);
  });

  it("does not mutate the input", () => {
    const input = [cube(0, 0, 0), cube(1, -1, 0)];
    const snapshot = JSON.stringify(input);
    hexArrow(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input).toHaveLength(2);
  });
});
