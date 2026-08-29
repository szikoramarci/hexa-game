import type { Cube } from "../coordinates/coordinates.js";

const f = (n: number): string => n.toFixed(2);

/** Every hex of the disc of the given radius, row by row (deterministic order). */
export function disc(radius: number): Cube[] {
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

/** The six corners of a pointy-top hex centred at `(cx, cy)` as an SVG point list. */
export function hexCorners(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${f(cx + size * Math.cos(angle))},${f(cy + size * Math.sin(angle))}`);
  }
  return pts.join(" ");
}
