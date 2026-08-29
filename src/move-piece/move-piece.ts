import type { Cube } from "../coordinates/coordinates.js";
import { cubeDistance } from "../distance/distance.js";
import { cubeToPixel, DEFAULT_HEX_SIZE, type Pixel } from "../layout/layout.js";

/**
 * How a piece travels between hexes:
 * - `"ground"` — slides along the chord at a constant scale.
 * - `"jump"` — same straight slide, but scales up to {@link MoveOptions.jumpPeak}
 *   at the apex and back to `1` on landing, faking a hop over the gap.
 */
export type MoveMode = "ground" | "jump";

export interface MoveOptions {
  /** Travel style. Default `"ground"`. */
  mode?: MoveMode;
  /**
   * Hexes per second for a single-hex step — the reference speed. Default `6`.
   */
  speed?: number;
  /**
   * Distance exponent: `durationMs = hexes ** falloff / speed`. `1` keeps a
   * strictly constant on-screen speed (long moves take proportionally longer);
   * below `1` the piece speeds up over distance so a far slide still feels
   * snappy. Default `0.65`.
   */
  falloff?: number;
  /** Hex centre-to-corner distance in pixels. Default {@link DEFAULT_HEX_SIZE}. */
  size?: number;
  /** Scale at the apex of a `"jump"`. Default `1.6`. Ignored for `"ground"`. */
  jumpPeak?: number;
  /** Floor for a non-zero move's duration, in ms. Default `90`. */
  minMs?: number;
}

/** The piece's transform at one instant: centre position and uniform scale. */
export interface MoveFrame {
  x: number;
  y: number;
  scale: number;
}

export interface MovePlan {
  /** Pixel centre of the start hex. */
  from: Pixel;
  /** Pixel centre of the end hex. */
  to: Pixel;
  /** Hex-step distance between the endpoints (`cubeDistance`). */
  hexes: number;
  /** How long the move lasts, in ms. `0` for an in-place `"ground"` move. */
  durationMs: number;
  mode: MoveMode;
  /** Piece transform at normalised time `t`; `t` is clamped to `[0, 1]`. */
  at(t: number): MoveFrame;
}

const DEFAULT_SPEED = 6;
const DEFAULT_FALLOFF = 0.65;
const DEFAULT_JUMP_PEAK = 1.6;
const DEFAULT_MIN_MS = 90;

const f = (n: number): string => n.toFixed(2);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Plan an animation that carries a board piece from `start` to `end`.
 *
 * The result is pure data plus a sampler — nothing is animated here. Feed
 * {@link moveKeyframes} straight into `element.animate(...)`, or drive
 * {@link MovePlan.at} from your own loop. The moved element's local origin must
 * be its visual centre so `translate` lands it on the hex centre and `scale`
 * grows about it.
 *
 * Duration is `hexes ** falloff / speed` seconds (floored at `minMs` for any
 * real move). With the default `falloff` below `1` the piece accelerates over
 * distance — a 1-hex step and a long slide both feel snappy, the long one just
 * lasts a bit longer rather than proportionally longer.
 *
 * @param start   Start hex. Never mutated.
 * @param end     End hex. Never mutated.
 * @param options See {@link MoveOptions} for defaults.
 */
export function movePiece(
  start: Cube,
  end: Cube,
  options?: MoveOptions,
): MovePlan {
  const size = options?.size ?? DEFAULT_HEX_SIZE;
  const speed = options?.speed ?? DEFAULT_SPEED;
  const falloff = options?.falloff ?? DEFAULT_FALLOFF;
  const mode: MoveMode = options?.mode ?? "ground";
  const jumpPeak = options?.jumpPeak ?? DEFAULT_JUMP_PEAK;
  const minMs = options?.minMs ?? DEFAULT_MIN_MS;

  const from = cubeToPixel(start, size);
  const to = cubeToPixel(end, size);
  const hexes = cubeDistance(start, end);

  const durationMs =
    hexes > 0
      ? Math.max((Math.pow(hexes, falloff) / speed) * 1000, minMs)
      : mode === "jump"
        ? minMs
        : 0;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const at = (t: number): MoveFrame => {
    const u = clamp01(t);
    const scale =
      mode === "jump" ? 1 + (jumpPeak - 1) * Math.sin(Math.PI * u) : 1;
    return { x: from.x + dx * u, y: from.y + dy * u, scale };
  };

  return { from, to, hexes, durationMs, mode, at };
}

/**
 * Sample a {@link MovePlan} into Web Animations keyframes:
 * `{ offset, transform: "translate(Xpx, Ypx) scale(S)" }`, `steps + 1` of them,
 * evenly spaced, every number fixed to 2 decimals.
 *
 * The `transform` is CSS syntax (comma-separated, `px` units) so it drops
 * straight into `element.animate`. WAAPI animates the CSS `transform` property,
 * not the SVG `transform` *attribute* — give the moved element
 * `transform-box: fill-box; transform-origin: center` so the `scale` pivots on
 * the piece rather than the SVG origin:
 *
 * ```ts
 * const plan = movePiece(a, b, { mode: "jump" });
 * el.style.transformBox = "fill-box";
 * el.style.transformOrigin = "center";
 * el.animate(moveKeyframes(plan), { duration: plan.durationMs, easing: "linear" });
 * ```
 *
 * @param plan  A plan from {@link movePiece}.
 * @param steps Segment count. Default `24`; clamped to at least `1`.
 */
export function moveKeyframes(
  plan: MovePlan,
  steps: number = 24,
): Array<{ offset: number; transform: string }> {
  const n = Math.max(1, Math.floor(steps));
  const frames: Array<{ offset: number; transform: string }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const frame = plan.at(t);
    frames.push({
      offset: i === n ? 1 : t,
      transform: `translate(${f(frame.x)}px, ${f(frame.y)}px) scale(${f(frame.scale)})`,
    });
  }
  return frames;
}
