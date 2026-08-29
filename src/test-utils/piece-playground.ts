import { cubeKey, type Cube } from "../coordinates/coordinates.js";
import { cubeToPixel, DEFAULT_HEX_SIZE } from "../layout/layout.js";
import { ballMarker, disc, hexCorners, playerMarker } from "./board.js";
import { actionPage, registerActionGroup } from "./gallery.js";
import type { MoveMode } from "../move-piece/move-piece.js";
import type { RenderOptions } from "./render-scenario.js";

/** Palette shared with the static renderer. */
const COLOR = {
  empty: "#e8e8e8",
  hover: "#dbe9ff",
  pit: "#3a3a3a",
  grid: "#999",
  player: "#d33",
} as const;

const f = (n: number): string => n.toFixed(2);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One piece sitting on a board. */
export interface PiecePlacement {
  kind: "player" | "ball";
  /** Starting hex. */
  at: Cube;
  /** Player only. Default the 1-based slot number. */
  label?: string | number;
  /** Player fill. Default red. */
  color?: string;
  /** Pin this piece's travel mode; otherwise it follows the page toggle. */
  mode?: MoveMode;
}

/** One titled board on the piece-animation page. */
export interface PieceCase {
  title: string;
  /** Hex disc radius, centred on the origin. */
  radius: number;
  pieces: readonly PiecePlacement[];
  /** Decorative "pit" hexes drawn dark — a gap to jump. Does not block. */
  pit?: Iterable<Cube>;
  /** Hexes per second for this board. Default 6. */
  speed?: number;
  /** Initial page toggle for un-pinned pieces. Default `"ground"`. */
  defaultMode?: MoveMode;
}

interface PieceData {
  size: number;
  speed: number;
  falloff: number;
  minMs: number;
  jumpPeak: number;
  defaultMode: MoveMode;
  board: string[];
  pit: string[];
  pieces: Array<{ kind: string; at: string; mode: MoveMode | null }>;
}

/** The `<section>` markup for one case, plus the data blob its script needs. */
function renderCase(
  id: string,
  c: PieceCase,
  size: number,
): { section: string; data: PieceData } {
  const hexes = disc(c.radius);
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

  const pitKeys = new Set<string>();
  for (const p of c.pit ?? []) pitKeys.add(cubeKey(p));

  const polygons = hexes
    .map((h, i) => {
      const q = centres[i]!;
      const key = cubeKey(h);
      const cls = pitKeys.has(key) ? "hex pit" : "hex";
      return (
        `        <polygon class="${cls}" data-key="${key}" ` +
        `points="${hexCorners(q.x, q.y, size)}" />`
      );
    })
    .join("\n");

  const pieceEls: string[] = [];
  const pieceData: PieceData["pieces"] = [];
  c.pieces.forEach((p, i) => {
    const q = cubeToPixel(p.at, size);
    const marker =
      p.kind === "ball"
        ? ballMarker(size, `${id}-p${i}`)
        : playerMarker(size, p.color ?? COLOR.player, p.label ?? i + 1);
    pieceEls.push(
      `        <g class="piece" data-piece="${i}" ` +
        `transform="translate(${f(q.x)} ${f(q.y)}) scale(1)">\n` +
        `          ${marker}\n` +
        `        </g>`,
    );
    pieceData.push({ kind: p.kind, at: cubeKey(p.at), mode: p.mode ?? null });
  });

  const defaultMode: MoveMode = c.defaultMode ?? "ground";
  const data: PieceData = {
    size,
    speed: c.speed ?? 6,
    falloff: 0.65,
    minMs: 90,
    jumpPeak: 1.6,
    defaultMode,
    board: hexes.map((h) => cubeKey(h)),
    pit: [...pitKeys],
    pieces: pieceData,
  };

  const modeBtn = (m: MoveMode): string =>
    `<button class="mode${m === defaultMode ? " active" : ""}" type="button" ` +
    `data-mode="${m}">${m}</button>`;

  const section =
    `    <section class="case" id="${id}">\n` +
    `      <h2>${escapeHtml(c.title)}</h2>\n` +
    `      <svg class="board" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">\n` +
    polygons +
    `\n` +
    pieceEls.join("\n") +
    `\n      </svg>\n` +
    `      <div class="hud">\n` +
    `        <span class="modes">${modeBtn("ground")}${modeBtn("jump")}</span>\n` +
    `        <span class="status"></span>\n` +
    `        <button class="reset" type="button">reset</button>\n` +
    `      </div>\n` +
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
  .hex { fill: ${COLOR.empty}; stroke: ${COLOR.grid}; stroke-width: 1;
    cursor: pointer; }
  .hex:hover { fill: ${COLOR.hover}; }
  .hex.pit { fill: ${COLOR.pit}; }
  .hex.pit:hover { fill: #4c4c4c; }
  .piece { pointer-events: none; }
  .hud { display: flex; align-items: center; gap: .5rem; margin-top: .5rem;
    font-size: .8rem; color: #666; }
  .status { flex: 1; font-variant-numeric: tabular-nums; }
  .mode, .reset { font: inherit; padding: .1rem .5rem; cursor: pointer;
    border: 1px solid #ccc; background: #f4f4f4; border-radius: 4px; }
  .mode.active { background: #1560c4; color: #fff; border-color: #1560c4; }`;

/**
 * The live layer, once per page. `initCase(section, D)` wires one board: a
 * mirror of `movePiece` (constant-speed duration, linear chord, `sin` scale
 * hump for a jump) driven from `requestAnimationFrame`, writing the SVG
 * `transform` attribute each frame. Click a hex to send every piece there; each
 * piece uses its pinned mode or the page toggle. No backticks / `${` so it
 * embeds verbatim.
 */
const SCRIPT = [
  "function keyParts(k) { return k.split(',').map(Number); }",
  "function toPixel(k, size) {",
  "  var p = keyParts(k);",
  "  return { x: size * Math.sqrt(3) * (p[0] + p[2] / 2), y: size * 1.5 * p[2] };",
  "}",
  "function hexDist(a, b) {",
  "  var p = keyParts(a), q = keyParts(b);",
  "  return (Math.abs(p[0]-q[0]) + Math.abs(p[1]-q[1]) + Math.abs(p[2]-q[2])) / 2;",
  "}",
  "function planMove(fromK, toK, mode, D) {",
  "  var a = toPixel(fromK, D.size), b = toPixel(toK, D.size);",
  "  var hexes = hexDist(fromK, toK);",
  "  var duration = hexes > 0",
  "    ? Math.max((Math.pow(hexes, D.falloff) / D.speed) * 1000, D.minMs)",
  "    : (mode === 'jump' ? D.minMs : 0);",
  "  return { a: a, b: b, hexes: hexes, duration: duration, mode: mode, jumpPeak: D.jumpPeak };",
  "}",
  "function frameAt(plan, t) {",
  "  var u = t < 0 ? 0 : t > 1 ? 1 : t;",
  "  var scale = plan.mode === 'jump'",
  "    ? 1 + (plan.jumpPeak - 1) * Math.sin(Math.PI * u)",
  "    : 1;",
  "  return {",
  "    x: plan.a.x + (plan.b.x - plan.a.x) * u,",
  "    y: plan.a.y + (plan.b.y - plan.a.y) * u,",
  "    scale: scale",
  "  };",
  "}",
  "function transformFor(x, y, s) {",
  "  return 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') scale(' + s.toFixed(2) + ')';",
  "}",
  "",
  "function initCase(section, D) {",
  "  var svg = section.querySelector('.board');",
  "  var statusEl = section.querySelector('.status');",
  "  var hexEls = svg.querySelectorAll('.hex');",
  "  var pieceEls = svg.querySelectorAll('.piece');",
  "  var modeBtns = section.querySelectorAll('.mode');",
  "",
  "  var pageMode = D.defaultMode;",
  "  var cur = D.pieces.map(function (p) { return p.at; });",
  "  var runners = [];",
  "  var moving = false;",
  "",
  "  function stop() {",
  "    runners.forEach(function (r) { r.done = true; if (r.raf) cancelAnimationFrame(r.raf); });",
  "    runners = [];",
  "  }",
  "  function place(el, x, y, s) { el.setAttribute('transform', transformFor(x, y, s)); }",
  "",
  "  function animate(el, plan, whenDone) {",
  "    var r = { raf: 0, done: false, t0: 0 };",
  "    if (plan.duration <= 0) { place(el, plan.b.x, plan.b.y, 1); whenDone(); return r; }",
  "    function step(now) {",
  "      if (r.done) return;",
  "      if (!r.t0) r.t0 = now;",
  "      var t = (now - r.t0) / plan.duration;",
  "      if (t >= 1) { place(el, plan.b.x, plan.b.y, 1); r.done = true; whenDone(); return; }",
  "      var fr = frameAt(plan, t);",
  "      place(el, fr.x, fr.y, fr.scale);",
  "      r.raf = requestAnimationFrame(step);",
  "    }",
  "    r.raf = requestAnimationFrame(step);",
  "    return r;",
  "  }",
  "",
  "  function sendTo(targetK) {",
  "    if (moving) return;",
  "    stop();",
  "    var pending = 0;",
  "    var report = { hexes: 0, ms: 0, mode: pageMode };",
  "    var batch = [];",
  "    D.pieces.forEach(function (p, i) {",
  "      var el = pieceEls[i];",
  "      var mode = p.mode || pageMode;",
  "      var plan = planMove(cur[i], targetK, mode, D);",
  "      cur[i] = targetK;",
  "      if (plan.hexes > report.hexes) { report.hexes = plan.hexes; report.mode = mode; }",
  "      if (plan.duration > report.ms) report.ms = plan.duration;",
  "      pending++;",
  "      batch.push(animate(el, plan, function () {",
  "        pending--;",
  "        if (pending === 0) moving = false;",
  "      }));",
  "    });",
  "    runners = batch;",
  "    moving = pending > 0;",
  "    statusEl.textContent = report.mode + '  \\u00b7  ' + report.hexes +",
  "      ' hex' + (report.hexes === 1 ? '' : 'es') + '  \\u00b7  ' + Math.round(report.ms) + ' ms';",
  "  }",
  "",
  "  hexEls.forEach(function (el) {",
  "    el.addEventListener('click', function () { sendTo(el.dataset.key); });",
  "  });",
  "  modeBtns.forEach(function (btn) {",
  "    btn.addEventListener('click', function () {",
  "      if (moving) return;",
  "      pageMode = btn.dataset.mode;",
  "      modeBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });",
  "    });",
  "  });",
  "  section.querySelector('.reset').addEventListener('click', function () {",
  "    stop();",
  "    moving = false;",
  "    D.pieces.forEach(function (p, i) {",
  "      cur[i] = p.at;",
  "      var q = toPixel(p.at, D.size);",
  "      place(pieceEls[i], q.x, q.y, 1);",
  "    });",
  "    statusEl.textContent = '';",
  "  });",
  "}",
  "CASES.forEach(function (c) { initCase(document.getElementById(c.id), c.data); });",
].join("\n");

/**
 * Render every {@link PieceCase} onto one interactive page at
 * `scenarios/actions/<slug>/index.html` and register it on the landing nav.
 * Returns the page HTML.
 *
 * @param slug   Action folder / landing card slug (e.g. `"move-piece"`).
 * @param label  Landing-card title.
 * @param blurb  Landing-card one-liner.
 * @param cases  The boards, in display order.
 */
export function writePiecePlayground(
  slug: string,
  label: string,
  blurb: string,
  cases: readonly PieceCase[],
  opts?: RenderOptions,
): string {
  const size = opts?.size ?? DEFAULT_HEX_SIZE;
  const rendered = cases.map((c, i) => renderCase(`case-${i}`, c, size));
  const manifest = rendered.map((r, i) => ({ id: `case-${i}`, data: r.data }));

  const body =
    `  <a class="back" href="../../index.html">&larr; all scenarios</a>\n` +
    `  <h1>${escapeHtml(label)}</h1>\n` +
    `  <p class="lede">${escapeHtml(blurb)} Click any hex to send the pieces ` +
    `there — the slide holds a constant speed however far it travels. Toggle ` +
    `<strong>ground</strong> / <strong>jump</strong> for the un-pinned pieces; ` +
    `a jump zooms in over the gap and back out on landing. ` +
    `<strong>reset</strong> restores the start.</p>\n` +
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
