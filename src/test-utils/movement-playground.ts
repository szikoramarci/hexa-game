import { cubeKey, type Cube } from "../coordinates/coordinates.js";
import { cubeToPixel, DEFAULT_HEX_SIZE } from "../layout/layout.js";
import { disc, hexCorners } from "./board.js";
import { actionPage, registerActionGroup } from "./gallery.js";
import type { RenderOptions } from "./render-scenario.js";

/** Palette shared with the static renderer. */
const COLOR = {
  empty: "#e8e8e8",
  reachable: "#bcd8ff",
  reachableHover: "#93c2ff",
  obstacle: "#4a4a4a",
  grid: "#999",
  piece: "#d33",
  arrow: "#ff8c00",
} as const;

const STEP_MS = 140;

/** A movable piece and how far it may travel, on one board. */
export interface MovementPlayground {
  /** Draw the full hex disc of this radius, centred on the origin. */
  radius: number;
  /** The piece: where it starts and the number drawn on it. */
  piece: { at: Cube; label: string | number };
  /** Step budget — how many hexes it can move in one action. */
  budget: number;
  /** Hexes the piece may neither enter nor cross. */
  obstacle?: Iterable<Cube>;
}

/** One titled case on the movement page. */
export interface MovementCase {
  /** Short heading above the board. */
  title: string;
  play: MovementPlayground;
}

const f = (n: number): string => n.toFixed(2);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface CaseData {
  size: number;
  budget: number;
  origin: string;
  label: string;
  board: string[];
  obstacles: string[];
}

/** The `<section>` markup for one case, plus the data blob its script needs. */
function renderCase(
  id: string,
  c: MovementCase,
  size: number,
): { section: string; data: CaseData } {
  const p = c.play;
  const hexes = disc(p.radius);
  const centres = hexes.map((h) => cubeToPixel(h, size));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of centres) {
    minX = Math.min(minX, q.x - size);
    minY = Math.min(minY, q.y - size);
    maxX = Math.max(maxX, q.x + size);
    maxY = Math.max(maxY, q.y + size);
  }
  const pad = size;
  const vb = `${f(minX - pad)} ${f(minY - pad)} ${f(maxX - minX + pad * 2)} ${f(
    maxY - minY + pad * 2,
  )}`;

  const obstacleKeys = new Set<string>();
  for (const o of p.obstacle ?? []) obstacleKeys.add(cubeKey(o));

  const polygons = hexes
    .map((h, i) => {
      const q = centres[i]!;
      const key = cubeKey(h);
      const cls = obstacleKeys.has(key) ? "hex obs" : "hex";
      return (
        `        <polygon class="${cls}" data-key="${key}" ` +
        `points="${hexCorners(q.x, q.y, size)}" />`
      );
    })
    .join("\n");

  const start = cubeToPixel(p.piece.at, size);
  const label = String(p.piece.label);
  const data: CaseData = {
    size,
    budget: p.budget,
    origin: cubeKey(p.piece.at),
    label,
    board: hexes.map((h) => cubeKey(h)),
    obstacles: [...obstacleKeys],
  };

  const section =
    `    <section class="case" id="${id}">\n` +
    `      <h2>${escapeHtml(c.title)}</h2>\n` +
    `      <svg class="board" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">\n` +
    polygons +
    `\n        <g class="arrow-layer"></g>\n` +
    `        <g class="piece" transform="translate(${f(start.x)} ${f(start.y)})">\n` +
    `          <circle r="${f(size * 0.62)}" fill="${COLOR.piece}" ` +
    `stroke="#fff" stroke-width="${f(size * 0.09)}" />\n` +
    `          <text text-anchor="middle" dominant-baseline="central" fill="#fff" ` +
    `font-size="${f(size * 0.8)}" font-family="sans-serif" font-weight="700">` +
    `${escapeHtml(label)}</text>\n` +
    `        </g>\n` +
    `      </svg>\n` +
    `      <div class="hud"><span class="status"></span>` +
    `<button class="reset" type="button">reset</button></div>\n` +
    `    </section>`;

  return { section, data };
}

const CASES_CSS = `
  .lede { max-width: 46rem; }
  .cases { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: start; }
  .case { border: 1px solid #e2e2e2; border-radius: 8px; padding: .75rem;
    background: #fff; width: 360px; }
  .case h2 { margin: 0 0 .5rem; font-size: .9rem; }
  .board { display: block; width: 100%; height: auto; touch-action: none; }
  .hex { fill: ${COLOR.empty}; stroke: ${COLOR.grid}; stroke-width: 1; }
  .hex.obs { fill: ${COLOR.obstacle}; }
  .hex.reach { fill: ${COLOR.reachable}; cursor: pointer; }
  .hex.reach:hover { fill: ${COLOR.reachableHover}; }
  .arrow-layer { pointer-events: none; }
  .piece { pointer-events: none; transition: transform ${STEP_MS}ms linear; }
  .hud { display: flex; align-items: center; justify-content: space-between;
    gap: .75rem; margin-top: .5rem; font-size: .8rem; color: #666; }
  .reset { font: inherit; padding: .1rem .55rem; cursor: pointer; }`;

/**
 * The live layer, once per page. `initCase(section, DATA)` wires one board:
 * a mirror of `cubeToPixel` + a BFS flood from the piece that doubles as
 * `reachableCubes` and an all-targets shortest-path tree (unit step cost, so
 * BFS parents *are* the shortest path). Hover a reachable hex for the dashed
 * move arrow; click to walk there; moving re-floods from the new hex; reset
 * restores the start. No backticks / `${` so it embeds verbatim.
 */
const SCRIPT = [
  "var STEP_MS = " + STEP_MS + ";",
  "var DIRS = [[1,-1,0],[1,0,-1],[0,1,-1],[-1,1,0],[-1,0,1],[0,-1,1]];",
  "function neighbours(key) {",
  "  var p = key.split(',').map(Number);",
  "  return DIRS.map(function (d) { return (p[0]+d[0])+','+(p[1]+d[1])+','+(p[2]+d[2]); });",
  "}",
  "function initCase(section, DATA) {",
  "  var SIZE = DATA.size;",
  "  var board = new Set(DATA.board);",
  "  var blocked = new Set(DATA.obstacles);",
  "  var svg = section.querySelector('.board');",
  "  var arrowLayer = svg.querySelector('.arrow-layer');",
  "  var pieceEl = svg.querySelector('.piece');",
  "  var statusEl = section.querySelector('.status');",
  "  var hexEls = new Map();",
  "  svg.querySelectorAll('.hex').forEach(function (el) { hexEls.set(el.dataset.key, el); });",
  "",
  "  function toPixel(key) {",
  "    var p = key.split(',').map(Number);",
  "    return { x: SIZE * Math.sqrt(3) * (p[0] + p[2] / 2), y: SIZE * 1.5 * p[2] };",
  "  }",
  "  function flood(origin) {",
  "    var dist = new Map([[origin, 0]]);",
  "    var cameFrom = new Map();",
  "    var frontier = [origin];",
  "    for (var d = 0; d < DATA.budget && frontier.length; d++) {",
  "      var next = [];",
  "      for (var i = 0; i < frontier.length; i++) {",
  "        var ns = neighbours(frontier[i]);",
  "        for (var j = 0; j < ns.length; j++) {",
  "          var nk = ns[j];",
  "          if (dist.has(nk) || blocked.has(nk) || !board.has(nk)) continue;",
  "          dist.set(nk, d + 1);",
  "          cameFrom.set(nk, frontier[i]);",
  "          next.push(nk);",
  "        }",
  "      }",
  "      frontier = next;",
  "    }",
  "    return { dist: dist, cameFrom: cameFrom };",
  "  }",
  "  function pathTo(cameFrom, target) {",
  "    var path = [target], step = target;",
  "    while (cameFrom.has(step)) { step = cameFrom.get(step); path.unshift(step); }",
  "    return path;",
  "  }",
  "",
  "  function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }",
  "  function drawArrow(path) {",
  "    arrowLayer.replaceChildren();",
  "    if (path.length < 2) return;",
  "    var pts = path.map(toPixel);",
  "    var poly = svgEl('polyline');",
  "    poly.setAttribute('points', pts.map(function (q) { return q.x.toFixed(2)+','+q.y.toFixed(2); }).join(' '));",
  "    poly.setAttribute('fill', 'none');",
  "    poly.setAttribute('stroke', '" + COLOR.arrow + "');",
  "    poly.setAttribute('stroke-width', (SIZE * 0.16).toFixed(2));",
  "    poly.setAttribute('stroke-linecap', 'round');",
  "    poly.setAttribute('stroke-linejoin', 'round');",
  "    poly.setAttribute('stroke-dasharray', (SIZE*0.34).toFixed(2)+' '+(SIZE*0.28).toFixed(2));",
  "    arrowLayer.appendChild(poly);",
  "    var a = pts[pts.length - 2], b = pts[pts.length - 1];",
  "    var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;",
  "    var ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;",
  "    var hl = SIZE * 0.5, hw = SIZE * 0.28;",
  "    var bx = b.x - ux * hl, by = b.y - uy * hl;",
  "    var head = svgEl('polygon');",
  "    head.setAttribute('points', [",
  "      b.x.toFixed(2)+','+b.y.toFixed(2),",
  "      (bx - uy*hw).toFixed(2)+','+(by + ux*hw).toFixed(2),",
  "      (bx + uy*hw).toFixed(2)+','+(by - ux*hw).toFixed(2)",
  "    ].join(' '));",
  "    head.setAttribute('fill', '" + COLOR.arrow + "');",
  "    arrowLayer.appendChild(head);",
  "  }",
  "",
  "  var origin = DATA.origin;",
  "  var tree = flood(origin);",
  "  var moving = false;",
  "",
  "  function placePiece(key) {",
  "    var q = toPixel(key);",
  "    pieceEl.setAttribute('transform', 'translate(' + q.x.toFixed(2) + ' ' + q.y.toFixed(2) + ')');",
  "  }",
  "  function paint() {",
  "    var count = 0;",
  "    hexEls.forEach(function (el, key) {",
  "      var on = tree.dist.has(key) && key !== origin && !blocked.has(key);",
  "      el.classList.toggle('reach', on);",
  "      if (on) count++;",
  "    });",
  "    statusEl.textContent = 'budget ' + DATA.budget + '  \\u00b7  ' + count + ' hexes in reach';",
  "  }",
  "  function recompute() { tree = flood(origin); paint(); }",
  "",
  "  function move(path) {",
  "    moving = true;",
  "    arrowLayer.replaceChildren();",
  "    var i = 1;",
  "    (function stepOn() {",
  "      if (i >= path.length) { moving = false; origin = path[path.length - 1]; recompute(); return; }",
  "      placePiece(path[i]);",
  "      i++;",
  "      setTimeout(stepOn, STEP_MS);",
  "    })();",
  "  }",
  "",
  "  hexEls.forEach(function (el, key) {",
  "    el.addEventListener('pointerenter', function () {",
  "      if (moving || key === origin || !tree.dist.has(key)) return;",
  "      drawArrow(pathTo(tree.cameFrom, key));",
  "    });",
  "    el.addEventListener('pointerleave', function () { if (!moving) arrowLayer.replaceChildren(); });",
  "    el.addEventListener('click', function () {",
  "      if (moving || key === origin || !tree.dist.has(key)) return;",
  "      move(pathTo(tree.cameFrom, key));",
  "    });",
  "  });",
  "  section.querySelector('.reset').addEventListener('click', function () {",
  "    if (moving) return;",
  "    origin = DATA.origin;",
  "    placePiece(origin);",
  "    arrowLayer.replaceChildren();",
  "    recompute();",
  "  });",
  "",
  "  paint();",
  "}",
  "CASES.forEach(function (c) { initCase(document.getElementById(c.id), c.data); });",
].join("\n");

/**
 * Render every {@link MovementCase} onto one interactive page at
 * `scenarios/actions/<slug>/index.html` and register it on the landing nav.
 * Returns the page HTML.
 *
 * @param slug   Action folder / landing card slug (e.g. `"movement"`).
 * @param label  Landing-card title (e.g. `"piece movement"`).
 * @param blurb  Landing-card one-liner.
 * @param cases  The boards, in display order.
 */
export function writeMovementPlayground(
  slug: string,
  label: string,
  blurb: string,
  cases: readonly MovementCase[],
  opts?: RenderOptions,
): string {
  const size = opts?.size ?? DEFAULT_HEX_SIZE;
  const rendered = cases.map((c, i) => renderCase(`case-${i}`, c, size));
  const manifest = rendered.map((r, i) => ({ id: `case-${i}`, data: r.data }));

  const body =
    `  <a class="back" href="../../index.html">&larr; all scenarios</a>\n` +
    `  <h1>${escapeHtml(label)}</h1>\n` +
    `  <p class="lede">${escapeHtml(blurb)} Reachable hexes are blue — hover ` +
    `one for the dashed move arrow, click to walk the piece there step by step. ` +
    `Obstacles (dark) block the flood and the path; after a move the region ` +
    `recomputes from the new hex. <strong>reset</strong> restores the start.</p>\n` +
    `  <div class="cases">\n` +
    rendered.map((r) => r.section).join("\n") +
    `\n  </div>\n` +
    `  <script>\nvar CASES = ${JSON.stringify(manifest)};\n` +
    SCRIPT +
    `\n  </script>`;

  const html = actionPage(`${label} — hexa-game`, CASES_CSS, body);
  registerActionGroup(slug, { label, blurb, count: cases.length }, html);
  return html;
}
