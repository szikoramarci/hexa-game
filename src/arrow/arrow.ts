import { cubeEquals, type Cube } from "../coordinates/coordinates.js";
import { cubeToPixel } from "../layout/layout.js";

/**
 * Shaft geometry:
 * - `"straight"` — segments through every hex centre; a route across the board.
 * - `"curved"` with 3+ hexes — a smoothed spline through every centre; a
 *   winding route across the board.
 * - `"curved"` with exactly 2 hexes — a **jump**: the shaft leaves the board at
 *   the start, arcs up over the gap, and lands on the end hex. A faint chord and
 *   a vertical apex tick mark the ground line and the hop height.
 */
export type ArrowShape = "straight" | "curved";

/** Stroke heft, scaled from {@link ArrowStyle.size}. */
export type ArrowWeight = "thin" | "normal" | "thick";

/** Solid or dashed shaft. The arrowhead is never dashed. */
export type ArrowDash = "solid" | "dashed";

export interface ArrowStyle {
  /** Straight segments (default) or a Catmull-Rom spline through the centres. */
  shape?: ArrowShape;
  /** Stroke width bucket. Default `"normal"`. */
  weight?: ArrowWeight;
  /** Default `"solid"`. */
  dash?: ArrowDash;
  /** Stroke and arrowhead colour. Default `"#ff8c00"`. */
  color?: string;
  /** Hex centre-to-corner distance in pixels. Default 26 (matches the renderer). */
  size?: number;
  /**
   * Hop height of a two-hex `"curved"` jump, as a fraction of the start-to-end
   * distance (with a floor so short hops still lift clear of the ground).
   * Default `0.22`. `0` flattens the jump into a plain line; a negative value
   * arcs downward. Ignored for `"straight"` arrows and for `"curved"` paths with
   * 3+ hexes.
   */
  bow?: number;
}

const DEFAULT_SIZE = 26;
const DEFAULT_COLOR = "#ff8c00";
const DEFAULT_BOW = 0.22;

/** Stroke width as a fraction of `size`. */
const WEIGHT_FACTOR: Record<ArrowWeight, number> = {
  thin: 0.08,
  normal: 0.15,
  thick: 0.28,
};

const f = (n: number): string => n.toFixed(2);

interface Pt {
  x: number;
  y: number;
}

/** Unit vector from `a` to `b`; `{x:1,y:0}` if the two coincide. */
function unit(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

/** Drop consecutive duplicate hexes so segments never have zero length. */
function collapse(hexes: Cube[]): Cube[] {
  const out: Cube[] = [];
  for (const h of hexes) {
    const prev = out[out.length - 1];
    if (!prev || !cubeEquals(prev, h)) out.push({ x: h.x, y: h.y, z: h.z });
  }
  return out;
}

/**
 * The apex of a jump between `a` and `b`: straight up (screen `-y`) from the
 * chord midpoint by `bow` of the chord length, floored at `0.8 * size` for a
 * positive `bow` so short hops still clear the ground.
 */
function jumpApex(a: Pt, b: Pt, bow: number, size: number): Pt {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const lift = bow > 0 ? Math.max(bow * chord, size * 0.8) : bow * chord;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - lift };
}

/**
 * Catmull-Rom control points for the segment `p[i] -> p[i + 1]`, endpoints
 * clamped. Returns the two cubic-bezier handles.
 */
function catmullHandles(p: Pt[], i: number): [Pt, Pt] {
  const p0 = p[Math.max(0, i - 1)]!;
  const p1 = p[i]!;
  const p2 = p[i + 1]!;
  const p3 = p[Math.min(p.length - 1, i + 2)]!;
  return [
    { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  ];
}

/**
 * An SVG `<g>` fragment drawing an arrow through the centres of `hexes`, with
 * the head pointing at the last hex.
 *
 * Pass 2 or more hexes: the shaft runs through every centre in order and the tip
 * lands exactly on the last one. Consecutive duplicate hexes are collapsed
 * first; if fewer than 2 remain the call throws `RangeError`.
 *
 * Styling axes are independent — {@link ArrowWeight} (thin / normal / thick),
 * {@link ArrowDash} (solid / dashed) and `color`. {@link ArrowShape} also
 * decides meaning: `"straight"` and 3+-hex `"curved"` are routes across the
 * board; a 2-hex `"curved"` arrow is a **jump** — an arc that leaves the board
 * and lands again, drawn over a faint ground chord with a vertical apex tick
 * whose height is {@link ArrowStyle.bow}.
 *
 * Geometry uses the same pointy-top pixel map as the scenario renderer, so the
 * output drops straight into a rendered board.
 *
 * @param hexes Ordered path. Assumed integer coordinates; never mutated.
 * @param style Optional overrides; see {@link ArrowStyle} for defaults.
 * @returns A deterministic SVG `<g>` string, `pointer-events="none"`, all
 *          numbers fixed to 2 decimals. A route is `<path/><polygon/>`; a jump
 *          adds a ground `<line/>` and an apex `<line/>` behind them.
 */
export function hexArrow(hexes: Cube[], style?: ArrowStyle): string {
  const path = collapse(hexes);
  if (path.length < 2) {
    throw new RangeError(
      `hexArrow needs 2 or more distinct hexes, got ${path.length}`,
    );
  }

  const size = style?.size ?? DEFAULT_SIZE;
  const color = style?.color ?? DEFAULT_COLOR;
  const shape: ArrowShape = style?.shape ?? "straight";
  const weight: ArrowWeight = style?.weight ?? "normal";
  const dashed = (style?.dash ?? "solid") === "dashed";
  const bow = style?.bow ?? DEFAULT_BOW;

  const stroke = size * WEIGHT_FACTOR[weight];
  const headLen = size * 0.55 + stroke * 1.6;
  const headHalfWidth = size * 0.3 + stroke * 1.1;

  const centres = path.map((h) => cubeToPixel(h, size));
  const isJump = shape === "curved" && centres.length === 2 && bow !== 0;
  const pts = isJump
    ? [centres[0]!, jumpApex(centres[0]!, centres[1]!, bow, size), centres[1]!]
    : centres;
  const tip = pts[pts.length - 1]!;

  // Direction the head points: final tangent of the shaft.
  let headDir: Pt;
  if (shape === "curved") {
    const [, c2] = catmullHandles(pts, pts.length - 2);
    headDir = unit(c2, tip); // bezier derivative at t = 1 is 3 * (tip - c2)
  } else {
    headDir = unit(pts[pts.length - 2]!, tip);
  }
  const perp: Pt = { x: -headDir.y, y: headDir.x };

  // Pull the shaft back so the stroke stops behind the head.
  const back = headLen * 0.85;
  const shaftEnd: Pt = { x: tip.x - headDir.x * back, y: tip.y - headDir.y * back };
  const shaftPts = pts.slice(0, -1).concat(shaftEnd);

  const d =
    shape === "curved" ? curvedPath(shaftPts) : straightPath(shaftPts);

  const base: Pt = { x: tip.x - headDir.x * headLen, y: tip.y - headDir.y * headLen };
  const headPoints = [
    tip,
    { x: base.x + perp.x * headHalfWidth, y: base.y + perp.y * headHalfWidth },
    { x: base.x - perp.x * headHalfWidth, y: base.y - perp.y * headHalfWidth },
  ]
    .map((p) => `${f(p.x)},${f(p.y)}`)
    .join(" ");

  const dashAttr = dashed
    ? ` stroke-dasharray="${f(stroke * 2)} ${f(stroke * 1.5)}"`
    : "";

  const stroked = escapeAttr(color);
  const ground: string[] = [];
  if (isJump) {
    const a = centres[0]!;
    const b = centres[1]!;
    const apex = pts[1]!;
    // Faint chord on the board, then a vertical tick up to the arc's apex.
    ground.push(
      `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" ` +
        `stroke="${stroked}" stroke-width="${f(stroke * 0.6)}" ` +
        `stroke-opacity="0.4" stroke-linecap="round" />`,
      `<line x1="${f(apex.x)}" y1="${f((a.y + b.y) / 2)}" ` +
        `x2="${f(apex.x)}" y2="${f(apex.y)}" ` +
        `stroke="${stroked}" stroke-width="${f(stroke * 0.5)}" ` +
        `stroke-opacity="0.4" stroke-dasharray="${f(stroke * 1.2)} ${f(stroke * 1.2)}" />`,
    );
  }

  return (
    `<g fill="none" pointer-events="none">` +
    ground.join("") +
    `<path d="${d}" stroke="${stroked}" stroke-width="${f(stroke)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"${dashAttr} />` +
    `<polygon points="${headPoints}" fill="${stroked}" />` +
    `</g>`
  );
}

function straightPath(pts: Pt[]): string {
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`)
    .join(" ");
}

function curvedPath(pts: Pt[]): string {
  let d = `M ${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [c1, c2] = catmullHandles(pts, i);
    const end = pts[i + 1]!;
    d +=
      ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(end.x)} ${f(end.y)}`;
  }
  return d;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
