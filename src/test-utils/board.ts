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

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A player piece: a coloured disc a touch smaller than the hex, white-ringed,
 * with a centred number. Returned as a `<g>` centred on `(0, 0)` — wrap it in a
 * `translate` to place it, `scale` to animate a jump.
 */
export function playerMarker(
  size: number,
  color: string,
  label: string | number,
): string {
  const r = size * 0.6;
  return (
    `<g class="marker player">` +
    `<circle r="${f(r)}" fill="${esc(color)}" stroke="#fff" ` +
    `stroke-width="${f(size * 0.09)}" />` +
    `<text text-anchor="middle" dominant-baseline="central" fill="#fff" ` +
    `font-size="${f(size * 0.78)}" font-family="sans-serif" font-weight="700">` +
    `${esc(String(label))}</text>` +
    `</g>`
  );
}

/**
 * A ball: a small black-and-white striped disc. `id` disambiguates the pattern
 * and clip-path defs, so it must be unique within the containing document.
 * Returned as a `<g>` centred on `(0, 0)`.
 */
export function ballMarker(size: number, id: string): string {
  const r = size * 0.34;
  const bar = r * 0.42;
  const safeId = esc(id);
  return (
    `<g class="marker ball">` +
    `<defs>` +
    `<clipPath id="ball-clip-${safeId}"><circle r="${f(r)}" /></clipPath>` +
    `<pattern id="ball-stripe-${safeId}" width="${f(bar * 2)}" height="${f(bar * 2)}" ` +
    `patternUnits="userSpaceOnUse" patternTransform="rotate(35)">` +
    `<rect width="${f(bar * 2)}" height="${f(bar * 2)}" fill="#fff" />` +
    `<rect width="${f(bar)}" height="${f(bar * 2)}" fill="#1a1a1a" />` +
    `</pattern>` +
    `</defs>` +
    `<g clip-path="url(#ball-clip-${safeId})">` +
    `<rect x="${f(-r)}" y="${f(-r)}" width="${f(r * 2)}" height="${f(r * 2)}" ` +
    `fill="url(#ball-stripe-${safeId})" />` +
    `</g>` +
    `<circle r="${f(r)}" fill="none" stroke="#777" stroke-width="${f(size * 0.05)}" />` +
    `</g>`
  );
}
