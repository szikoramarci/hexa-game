import { cubeKey, type Cube } from "../coordinates.js";
import type { HexStatus, Scenario } from "./scenario.js";

export interface RenderOptions {
  /** Centre-to-corner distance in pixels. Default 26. */
  size?: number;
}

const DEFAULT_SIZE = 26;

/** Fill colour per status. `empty` is the fallback. */
const PALETTE: Record<HexStatus, string> = {
  empty: "#e8e8e8",
  reachable: "#bcd8ff",
  obstacle: "#4a4a4a",
  path: "#ff8c00",
  goal: "#2ecc71",
  player: "#d33",
};

/** Highest priority last so a later hit wins. */
const PRIORITY: readonly HexStatus[] = [
  "reachable",
  "obstacle",
  "path",
  "goal",
  "player",
];

const f = (n: number): string => n.toFixed(2);

/** Pointy-top cube -> pixel. Cube -> axial is `q = x`, `r = z`. */
function toPixel(c: Cube, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (c.x + c.z / 2),
    y: size * 1.5 * c.z,
  };
}

/** The six corners of a pointy-top hex centred at `(cx, cy)`. */
function hexCorners(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${f(cx + size * Math.cos(angle))},${f(cy + size * Math.sin(angle))}`);
  }
  return pts.join(" ");
}

/** Every hex of the disc of the given radius, row by row. */
function disc(radius: number): Cube[] {
  const hexes: Cube[] = [];
  for (let x = -radius; x <= radius; x++) {
    const yMin = Math.max(-radius, -x - radius);
    const yMax = Math.min(radius, -x + radius);
    for (let y = yMin; y <= yMax; y++) {
      hexes.push({ x, y, z: -x - y });
    }
  }
  return hexes;
}

function statusSets(s: Scenario): Map<HexStatus, Set<string>> {
  const sets = new Map<HexStatus, Set<string>>();
  const collect = (status: HexStatus, hexes: Iterable<Cube> | undefined) => {
    if (!hexes) return;
    const keys = new Set<string>();
    for (const h of hexes) keys.add(cubeKey(h));
    sets.set(status, keys);
  };
  collect("reachable", s.reachable);
  collect("obstacle", s.obstacle);
  collect("path", s.path);
  collect("goal", s.goal);
  collect("player", s.player);
  return sets;
}

/**
 * Render a {@link Scenario} to a standalone SVG string. Pure, deterministic
 * (all coordinates `.toFixed(2)`), zero dependencies.
 */
export function renderScenario(s: Scenario, opts?: RenderOptions): string {
  const size = opts?.size ?? DEFAULT_SIZE;
  const sets = statusSets(s);

  const hexes = disc(s.radius);
  const centres = hexes.map((h) => toPixel(h, size));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of centres) {
    minX = Math.min(minX, p.x - size);
    minY = Math.min(minY, p.y - size);
    maxX = Math.max(maxX, p.x + size);
    maxY = Math.max(maxY, p.y + size);
  }
  const pad = size;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  const polygons: string[] = [];
  for (let i = 0; i < hexes.length; i++) {
    const hex = hexes[i]!;
    const centre = centres[i]!;
    const key = cubeKey(hex);
    let status: HexStatus = "empty";
    for (const candidate of PRIORITY) {
      if (sets.get(candidate)?.has(key)) status = candidate;
    }
    polygons.push(
      `  <polygon points="${hexCorners(centre.x, centre.y, size)}" ` +
        `fill="${PALETTE[status]}" stroke="#999" stroke-width="1" />`,
    );
  }

  const overlays: string[] = [];
  const path = s.path ? [...s.path] : [];
  if (path.length >= 2) {
    const line = path
      .map((h) => {
        const p = toPixel(h, size);
        return `${f(p.x)},${f(p.y)}`;
      })
      .join(" ");
    overlays.push(
      `  <polyline points="${line}" fill="none" stroke="#ff8c00" ` +
        `stroke-width="3" pointer-events="none" />`,
    );
  }

  const titleEl = s.title
    ? `  <text x="${f(vbX + pad / 2)}" y="${f(vbY + pad)}" ` +
      `font-family="sans-serif" font-size="${f(size * 0.7)}" fill="#333">` +
      `${escapeXml(s.title)}</text>\n`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${f(vbX)} ${f(vbY)} ${f(vbW)} ${f(vbH)}">\n` +
    titleEl +
    polygons.join("\n") +
    (overlays.length ? "\n" + overlays.join("\n") : "") +
    `\n</svg>\n`
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
