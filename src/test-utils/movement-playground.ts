import { cubeKey, type Cube } from "../coordinates/coordinates.js";
import { cubeToPixel, DEFAULT_HEX_SIZE } from "../layout/layout.js";
import { disc, hexCorners, playerMarker } from "./board.js";
import { actionPage, registerActionGroup } from "./gallery.js";
import type { RenderOptions } from "./render-scenario.js";

/** Palette shared with the static renderer. */
const COLOR = {
  empty: "#e8e8e8",
  reachable: "#bcd8ff",
  reachableHover: "#93c2ff",
  obstacle: "#4a4a4a",
  grid: "#999",
  arrow: "#ff8c00",
} as const;

/** Piece fill, by index. */
const PIECE_COLORS = ["#d33", "#2478c9", "#2a9d5c", "#a3599f"] as const;

const STEP_MS = 140;

/** A piece the movement action can pick up and walk. */
export interface PlaygroundPiece {
  at: Cube;
  /** Drawn on the disc. */
  label: string | number;
  /** Hexes it may travel — its `movePoints`. */
  movePoints: number;
}

/** One board on the movement page. */
export interface MovementPlayground {
  /** Draw the full hex disc of this radius, centred on the origin. */
  radius: number;
  /** One or more pieces; click one to select it. */
  pieces: readonly PlaygroundPiece[];
  /** Hexes no piece may enter or cross. */
  obstacle?: Iterable<Cube>;
  /** Do pieces block each other? Default `true`. */
  piecesBlock?: boolean;
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
  board: string[];
  obstacles: string[];
  piecesBlock: boolean;
  pieces: { id: string; at: string; label: string; movePoints: number }[];
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

  const pieces = p.pieces.map((piece, i) => ({
    id: `${id}-p${i}`,
    at: cubeKey(piece.at),
    label: String(piece.label),
    movePoints: piece.movePoints,
    color: PIECE_COLORS[i % PIECE_COLORS.length]!,
  }));

  const pieceEls = pieces
    .map((piece, i) => {
      const px = cubeToPixel(p.pieces[i]!.at, size);
      return (
        `        <g class="piece" data-id="${piece.id}" data-home="${piece.at}" ` +
        `transform="translate(${f(px.x)} ${f(px.y)})">` +
        playerMarker(size, piece.color, piece.label) +
        `</g>`
      );
    })
    .join("\n");

  const data: CaseData = {
    size,
    board: hexes.map((h) => cubeKey(h)),
    obstacles: [...obstacleKeys],
    piecesBlock: p.piecesBlock !== false,
    pieces: pieces.map(({ id, at, label, movePoints }) => ({
      id,
      at,
      label,
      movePoints,
    })),
  };

  const section =
    `    <section class="case" id="${id}">\n` +
    `      <h2>${escapeHtml(c.title)}</h2>\n` +
    `      <svg class="board" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">\n` +
    polygons +
    `\n        <g class="arrow-layer"></g>\n` +
    pieceEls +
    `\n      </svg>\n` +
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
  .piece { cursor: pointer; transition: transform ${STEP_MS}ms linear; }
  .piece.selected { filter: drop-shadow(0 0 3px #1560c4); }
  .piece.dim { opacity: .5; }
  .hud { display: flex; align-items: center; justify-content: space-between;
    gap: .75rem; margin-top: .5rem; font-size: .8rem; color: #666; }
  .reset { font: inherit; padding: .1rem .55rem; cursor: pointer; }`;

/**
 * The live layer, once per page. `initCase(section, DATA)` is a faithful mirror
 * of `src/move-action/move-action.ts` — the same `MoveActionState`, the same
 * `idle -> aiming -> moving -> spent` reducer over the same events — running on
 * a small `cubeToPixel` + BFS-flood port (unit step cost, so BFS parents are the
 * shortest path, matching `movePath`). Kept honest by the playground test's
 * cross-check against the real module. No backticks / `${` so it embeds verbatim.
 */
const SCRIPT = [
  "var DIRS = [[1,-1,0],[1,0,-1],[0,1,-1],[-1,1,0],[-1,0,1],[0,-1,1]];",
  "var STEP_MS = " + STEP_MS + ";",
  "var ARROW = '" + COLOR.arrow + "';",
  "function neighbours(key) {",
  "  var p = key.split(',').map(Number);",
  "  return DIRS.map(function (d) { return (p[0]+d[0])+','+(p[1]+d[1])+','+(p[2]+d[2]); });",
  "}",
  "",
  "function initCase(section, DATA) {",
  "  var SIZE = DATA.size;",
  "  var board = new Set(DATA.board);",
  "  var obstacles = new Set(DATA.obstacles);",
  "  var svg = section.querySelector('.board');",
  "  var arrowLayer = svg.querySelector('.arrow-layer');",
  "  var statusEl = section.querySelector('.status');",
  "  var hexEls = new Map();",
  "  svg.querySelectorAll('.hex').forEach(function (el) { hexEls.set(el.dataset.key, el); });",
  "  var pieceEls = new Map();",
  "  svg.querySelectorAll('.piece').forEach(function (el) { pieceEls.set(el.dataset.id, el); });",
  "",
  "  function toPixel(key) {",
  "    var p = key.split(',').map(Number);",
  "    return { x: SIZE * Math.sqrt(3) * (p[0] + p[2] / 2), y: SIZE * 1.5 * p[2] };",
  "  }",
  "",
  "  // --- game state (mirrors MoveActionState) ---",
  "  var pieces = DATA.pieces.map(function (p) {",
  "    return { id: p.id, at: p.at, label: p.label, movePoints: p.movePoints,",
  "             home: p.at, homeMP: p.movePoints };",
  "  });",
  "  function piece(id) { return pieces.filter(function (p) { return p.id === id; })[0]; }",
  "",
  "  function blockersFor(id) {",
  "    var b = new Set(obstacles);",
  "    if (DATA.piecesBlock) pieces.forEach(function (p) { if (p.id !== id) b.add(p.at); });",
  "    return b;",
  "  }",
  "  function flood(id) {",
  "    var me = piece(id), blocked = blockersFor(id);",
  "    var dist = new Map([[me.at, 0]]), cameFrom = new Map(), frontier = [me.at];",
  "    for (var d = 0; d < me.movePoints && frontier.length; d++) {",
  "      var next = [];",
  "      for (var i = 0; i < frontier.length; i++) {",
  "        var ns = neighbours(frontier[i]);",
  "        for (var j = 0; j < ns.length; j++) {",
  "          var nk = ns[j];",
  "          if (dist.has(nk) || blocked.has(nk) || !board.has(nk)) continue;",
  "          dist.set(nk, d + 1); cameFrom.set(nk, frontier[i]); next.push(nk);",
  "        }",
  "      }",
  "      frontier = next;",
  "    }",
  "    return { dist: dist, cameFrom: cameFrom, origin: me.at };",
  "  }",
  "  function pathTo(tree, target) {",
  "    if (!tree || target === tree.origin || !tree.dist.has(target)) return null;",
  "    var path = [target], step = target;",
  "    while (tree.cameFrom.has(step)) { step = tree.cameFrom.get(step); path.unshift(step); }",
  "    return path;",
  "  }",
  "",
  "  // --- snapshot (mirrors MoveActionSnapshot) ---",
  "  var snap = { phase: 'idle', activeId: null, target: null, path: [], stepIndex: 0 };",
  "  var tree = null;",
  "  function aimingPhase(p) { return p.movePoints > 0 ? 'aiming' : 'spent'; }",
  "",
  "  function dispatch(ev) {",
  "    if (ev.type === 'selectPiece') {",
  "      if (snap.phase === 'moving') return;",
  "      var p = piece(ev.pieceId); if (!p) return;",
  "      snap = { phase: aimingPhase(p), activeId: p.id, target: null, path: [], stepIndex: 0 };",
  "      tree = flood(p.id);",
  "    } else if (ev.type === 'hoverHex') {",
  "      if (snap.phase !== 'aiming') return;",
  "      if (!ev.hex) { snap.target = null; snap.path = []; return; }",
  "      var pth = pathTo(tree, ev.hex);",
  "      if (pth) { snap.target = ev.hex; snap.path = pth; } else { snap.target = null; snap.path = []; }",
  "    } else if (ev.type === 'commit') {",
  "      if (snap.phase !== 'aiming') return;",
  "      var hex = ev.hex || snap.target; if (!hex) return;",
  "      var route = pathTo(tree, hex);",
  "      if (!route || route.length < 2) return;",
  "      snap.phase = 'moving'; snap.target = hex; snap.path = route; snap.stepIndex = 0;",
  "    } else if (ev.type === 'advance') {",
  "      if (snap.phase !== 'moving') return;",
  "      snap.stepIndex++;",
  "      if (snap.stepIndex < snap.path.length - 1) return;",
  "      var ap = piece(snap.activeId);",
  "      ap.at = snap.path[snap.path.length - 1];",
  "      ap.movePoints -= (snap.path.length - 1);",
  "      snap = { phase: aimingPhase(ap), activeId: ap.id, target: null, path: [], stepIndex: 0 };",
  "      tree = flood(ap.id);",
  "    } else if (ev.type === 'cancel') {",
  "      if (snap.phase === 'moving') return;",
  "      snap = { phase: 'idle', activeId: null, target: null, path: [], stepIndex: 0 };",
  "      tree = null;",
  "    }",
  "  }",
  "",
  "  // --- rendering (mirrors moveView) ---",
  "  function svgEl(t) { return document.createElementNS('http://www.w3.org/2000/svg', t); }",
  "  function drawArrow(path) {",
  "    arrowLayer.replaceChildren();",
  "    if (path.length < 2) return;",
  "    var pts = path.map(toPixel);",
  "    var poly = svgEl('polyline');",
  "    poly.setAttribute('points', pts.map(function (q) { return q.x.toFixed(2)+','+q.y.toFixed(2); }).join(' '));",
  "    poly.setAttribute('fill', 'none');",
  "    poly.setAttribute('stroke', ARROW);",
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
  "    head.setAttribute('fill', ARROW);",
  "    arrowLayer.appendChild(head);",
  "  }",
  "  function placePiece(el, key) {",
  "    var q = toPixel(key);",
  "    el.setAttribute('transform', 'translate(' + q.x.toFixed(2) + ' ' + q.y.toFixed(2) + ')');",
  "  }",
  "",
  "  function render() {",
  "    pieces.forEach(function (p) {",
  "      var el = pieceEls.get(p.id);",
  "      // while walking, the active piece sits on the hex it has reached so far",
  "      // (snap.stepIndex), so each `advance` slides it one hex along the path.",
  "      var moving = snap.phase === 'moving' && p.id === snap.activeId;",
  "      placePiece(el, moving ? snap.path[snap.stepIndex] : p.at);",
  "      el.classList.toggle('selected', p.id === snap.activeId);",
  "      el.classList.toggle('dim', p.movePoints === 0 && p.id !== snap.activeId);",
  "    });",
  "    var reach = new Set();",
  "    if (tree && (snap.phase === 'aiming' || snap.phase === 'spent')) {",
  "      tree.dist.forEach(function (d, key) { if (key !== tree.origin) reach.add(key); });",
  "    }",
  "    hexEls.forEach(function (el, key) { el.classList.toggle('reach', reach.has(key)); });",
  "    drawArrow(snap.path);",
  "    if (snap.phase === 'idle') statusEl.textContent = 'select a piece';",
  "    else if (snap.phase === 'moving') statusEl.textContent = 'moving\\u2026';",
  "    else {",
  "      var ap = piece(snap.activeId);",
  "      statusEl.textContent = ap.label + ': ' + ap.movePoints + ' MP  \\u00b7  ' + reach.size + ' in reach';",
  "    }",
  "  }",
  "",
  "  // Walk the committed path hex by hex: one `advance` per tick, render()",
  "  // slides the piece to the next hex (CSS transition on `.piece`).",
  "  function runMove() {",
  "    (function stepOn() {",
  "      if (snap.phase !== 'moving') return;",
  "      dispatch({ type: 'advance' });",
  "      render();",
  "      if (snap.phase === 'moving') setTimeout(stepOn, STEP_MS);",
  "    })();",
  "  }",
  "",
  "  hexEls.forEach(function (el, key) {",
  "    el.addEventListener('pointerenter', function () { dispatch({ type: 'hoverHex', hex: key }); render(); });",
  "    el.addEventListener('pointerleave', function () { dispatch({ type: 'hoverHex', hex: null }); render(); });",
  "    el.addEventListener('click', function () {",
  "      if (snap.phase !== 'aiming') return;",
  "      dispatch({ type: 'commit', hex: key });",
  "      if (snap.phase === 'moving') runMove(); else render();",
  "    });",
  "  });",
  "  pieceEls.forEach(function (el, id) {",
  "    el.addEventListener('click', function (e) {",
  "      e.stopPropagation();",
  "      dispatch({ type: 'selectPiece', pieceId: id });",
  "      render();",
  "    });",
  "  });",
  "  section.querySelector('.reset').addEventListener('click', function () {",
  "    if (snap.phase === 'moving') return;",
  "    pieces.forEach(function (p) { p.at = p.home; p.movePoints = p.homeMP; });",
  "    snap = { phase: 'idle', activeId: null, target: null, path: [], stepIndex: 0 };",
  "    tree = null;",
  "    render();",
  "  });",
  "",
  "  render();",
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
    `  <p class="lede">${escapeHtml(blurb)} <strong>Click a piece</strong> to ` +
    `pick it up — its reachable hexes turn blue. Hover one for the dashed move ` +
    `arrow, click it to walk there hex by hex. Obstacles (dark) and other pieces ` +
    `block; each move spends move points. Click another piece to switch, ` +
    `<strong>reset</strong> to start over. Same <code>idle → aiming → ` +
    `moving</code> reducer as <code>move-action</code>.</p>\n` +
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
