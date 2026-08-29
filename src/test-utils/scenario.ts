import type { Cube } from "../coordinates.js";

/**
 * The visual state of a single hex. When a hex qualifies for several of these at
 * once, the renderer paints only the highest-priority one:
 * `player > goal > path > obstacle > reachable > empty`.
 */
export type HexStatus =
  | "empty"
  | "obstacle"
  | "player"
  | "goal"
  | "reachable"
  | "path";

/**
 * A hand-authored hex-grid case to eyeball as an SVG. Feed real function output
 * (e.g. {@link reachableCubes}) straight into the marker fields.
 */
export interface Scenario {
  /** Draw the full hex disc of this radius, centred on the origin. */
  radius: number;
  title?: string;
  obstacle?: Iterable<Cube>;
  player?: Iterable<Cube>;
  goal?: Iterable<Cube>;
  reachable?: Iterable<Cube>;
  /** Ordered; also drawn as a connecting polyline through the hex centres. */
  path?: Iterable<Cube>;
}
