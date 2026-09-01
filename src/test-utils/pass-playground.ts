import { cubeEquals, cubeKey, type Cube } from "../coordinates/coordinates.js";
import { cubeToPixel, DEFAULT_HEX_SIZE } from "../layout/layout.js";
import {
  influencers,
  type MoveActionState,
  type Piece,
} from "../move-action/move-action.js";
import {
  passLane,
  passRangeCubes,
  passTargets,
  passThreats,
} from "../pass-action/pass-action.js";
import { ballMarker, disc, hexCorners, playerMarker } from "./board.js";
import { actionPage, registerActionGroup } from "./gallery.js";
import type { RenderOptions } from "./render-scenario.js";

/** Palette shared with the static renderer. */
const COLOR = {
  empty: "#e8e8e8",
  target: "#bcd8ff",
  targetHover: "#93c2ff",
  blocked: "#cfcfcf",
  grid: "#999",
  arrow: "#2d9cdb",
  danger: "#d33",
} as const;

/** Fill per team, in first-seen order. */
const TEAM_COLORS = ["#d33", "#2478c9"] as const;

const STEP_MS = 150;

/** A piece on a passing board. */
export interface PassPiece {
  at: Cube;
  /** Drawn on the disc. */
  label: string | number;
  /** Which side it is on — two teams per board. */
  team: string;
  /** Marks the ball carrier. Exactly one per board. */
  hasBall?: boolean;
}

/** One titled board on the passing page. */
export interface PassCase {
  title: string;
  /** Draw the full hex disc of this radius, centred on the origin. */
  radius: number;
  pieces: readonly PassPiece[];
  /** Kick reach in adjacent-hex spacings. Default 4. */
  passRange?: number;
  /** An interception roll at or above this picks the pass off. Default 6. */
  interceptOn?: number;
  /** Interception die. Default 6. */
  interceptDie?: number;
  /** Fixed dice seed; `reset` returns to it. Default derived from the case id. */
  seed?: number;
}

interface LaneData {
  hexes: string[];
  threats: string[];
  /** Ordered as the ball reaches them: `atIndex` is the lane hex that triggers the roll. */
  rolls: { id: string; at: string; atIndex: number }[];
  /** Label of the teammate who would receive it, or null (loose). */
  receiver: string | null;
}

interface CaseData {
  size: number;
  board: string[];
  carrierIndex: number;
  carrierAt: string;
  pieces: { at: string; label: string; color: string }[];
  targets: string[];
  blocked: string[];
  lanes: Record<string, LaneData>;
  interceptOn: number;
  interceptDie: number;
  seed: number;
}

const f = (n: number): string => n.toFixed(2);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A tiny non-crypto hash so an un-seeded case still gets a stable seed. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h | 0) || 1;
}

function toState(c: PassCase): { state: MoveActionState; carrier: Piece } {
  const pieces: Piece[] = c.pieces.map((p, i) => ({
    id: `p${i}`,
    label: p.label,
    at: p.at,
    movePoints: 0,
    team: p.team,
  }));
  const carrierPiece = c.pieces.findIndex((p) => p.hasBall);
  const ci = carrierPiece >= 0 ? carrierPiece : 0;
  const state: MoveActionState = {
    pieces,
    obstacles: [],
    ball: pieces[ci]!.at,
    passRange: c.passRange ?? 4,
    interceptOn: c.interceptOn ?? 6,
    interceptDie: c.interceptDie ?? 6,
  };
  return { state, carrier: pieces[ci]! };
}

/** The `<section>` markup for one case plus the data blob its script needs. */
function renderCase(
  id: string,
  c: PassCase,
  size: number,
): { section: string; data: CaseData } {
  const { state, carrier } = toState(c);
  const carrierId = carrier.id;

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

  const polygons = hexes
    .map((h, i) => {
      const q = centres[i]!;
      return (
        `        <polygon class="hex" data-key="${cubeKey(h)}" ` +
        `points="${hexCorners(q.x, q.y, size)}" />`
      );
    })
    .join("\n");

  const teamOrder: string[] = [];
  const colorFor = (team: string): string => {
    let idx = teamOrder.indexOf(team);
    if (idx < 0) {
      idx = teamOrder.push(team) - 1;
    }
    return TEAM_COLORS[idx % TEAM_COLORS.length]!;
  };
  // Seed the carrier's team as colour 0.
  colorFor(carrier.team);

  const pieceEls: string[] = [];
  const pieceData: CaseData["pieces"] = [];
  c.pieces.forEach((p, i) => {
    const q = cubeToPixel(p.at, size);
    const color = colorFor(p.team);
    pieceEls.push(
      `        <g class="piece" data-piece="${i}" ` +
        `transform="translate(${f(q.x)} ${f(q.y)})">\n` +
        `          ${playerMarker(size, color, p.label)}\n` +
        `        </g>`,
    );
    pieceData.push({ at: cubeKey(p.at), label: String(p.label), color });
  });

  const carrierQ = cubeToPixel(carrier.at, size);
  const ballEl =
    `        <g class="ball-layer" data-ball ` +
    `transform="translate(${f(carrierQ.x)} ${f(carrierQ.y)})">\n` +
    `          ${ballMarker(size, id)}\n` +
    `        </g>`;

  // Bake the pass geometry from the real modules.
  const targets = passTargets(state, carrierId);
  const targetKeys = targets.map(cubeKey);
  const rangeKeys = passRangeCubes(state, carrierId).map(cubeKey);
  const targetSet = new Set(targetKeys);
  const blocked = rangeKeys.filter((k) => !targetSet.has(k));

  const lanes: Record<string, LaneData> = {};
  for (const target of targets) {
    const laneHexes = passLane(state, carrierId, target);
    const rolls: LaneData["rolls"] = [];
    const seen = new Set<string>();
    for (let i = 1; i < laneHexes.length; i++) {
      for (const foe of influencers(state, laneHexes[i]!, carrier.team)) {
        if (seen.has(foe.id)) continue;
        seen.add(foe.id);
        rolls.push({ id: String(foe.label), at: cubeKey(foe.at), atIndex: i });
      }
    }
    const onTarget = state.pieces.find(
      (p) => p.id !== carrierId && cubeEquals(p.at, target),
    );
    lanes[cubeKey(target)] = {
      hexes: laneHexes.map(cubeKey),
      threats: passThreats(state, carrierId, target).map(cubeKey),
      rolls,
      receiver: onTarget ? String(onTarget.label) : null,
    };
  }

  const data: CaseData = {
    size,
    board: hexes.map(cubeKey),
    carrierIndex: c.pieces.findIndex((p) => p.hasBall) < 0 ? 0 : c.pieces.findIndex((p) => p.hasBall),
    carrierAt: cubeKey(carrier.at),
    pieces: pieceData,
    targets: targetKeys,
    blocked,
    lanes,
    interceptOn: state.interceptOn!,
    interceptDie: state.interceptDie!,
    seed: c.seed ?? hashSeed(id),
  };

  const section =
    `    <section class="case" id="${id}">\n` +
    `      <h2>${escapeHtml(c.title)}</h2>\n` +
    `      <svg class="board" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">\n` +
    polygons +
    `\n        <g class="arrow-layer"></g>\n` +
    pieceEls.join("\n") +
    `\n` +
    ballEl +
    `\n      </svg>\n` +
    `      <div class="hud">\n` +
    `        <span class="status"></span>\n` +
    `        <button class="reset" type="button">reset</button>\n` +
    `        <button class="shuffle" type="button">shuffle</button>\n` +
    `      </div>\n` +
    `      <p class="log"></p>\n` +
    `    </section>`;

  return { section, data };
}

const CASES_CSS = `
  .lede { max-width: 46rem; }
  .cases { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: start; }
  .case { border: 1px solid #e2e2e2; border-radius: 8px; padding: .75rem;
    background: #fff; width: 380px; }
  .case h2 { margin: 0 0 .5rem; font-size: .9rem; }
  .board { display: block; width: 100%; height: auto; touch-action: none; }
  .hex { fill: ${COLOR.empty}; stroke: ${COLOR.grid}; stroke-width: 1; }
  .hex.blocked { fill: ${COLOR.blocked}; }
  .hex.target { fill: ${COLOR.target}; cursor: pointer; }
  .hex.target:hover { fill: ${COLOR.targetHover}; }
  .hex.threat { animation: pulse .9s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { fill: ${COLOR.target}; } 50% { fill: ${COLOR.danger}; } }
  .hex.carrier { cursor: pointer; }
  .arrow-layer, .piece, .ball-layer { pointer-events: none; }
  .hud { display: flex; align-items: center; gap: .5rem; margin-top: .5rem;
    font-size: .8rem; color: #666; }
  .status { flex: 1; font-variant-numeric: tabular-nums; }
  .reset, .shuffle { font: inherit; padding: .1rem .5rem; cursor: pointer;
    border: 1px solid #ccc; background: #f4f4f4; border-radius: 4px; }
  .log { margin: .4rem 0 0; font-size: .78rem; color: #444; min-height: 1.2em;
    font-variant-numeric: tabular-nums; }`;

/**
 * The live layer, once per page. `initCase(section, D)` wires one board. All the
 * hex geometry (kick range, shadow, lane, interceptors) is **baked** from the
 * real `pass-action` module at generation time; the script only rolls the
 * seeded d6 (mulberry32, matching `src/dice`) and animates the ball. Click the
 * carrier to arm it, hover a blue hex for the lane, click it to kick. No
 * backticks / `${` so it embeds verbatim.
 */
const SCRIPT = [
  "function parse(k) { return k.split(',').map(Number); }",
  "function toPixel(k, size) {",
  "  var p = parse(k);",
  "  return { x: size * Math.sqrt(3) * (p[0] + p[2] / 2), y: size * 1.5 * p[2] };",
  "}",
  "// mulberry32, matching src/dice: [value, nextState]",
  "function nextRandom(s) {",
  "  var a = (s + 0x6d2b79f5) | 0;",
  "  var t = Math.imul(a ^ (a >>> 15), 1 | a);",
  "  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
  "  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];",
  "}",
  "function rollDie(s, sides) { var r = nextRandom(s); return [Math.floor(r[0]*sides)+1, r[1]]; }",
  "function svgEl(t) { return document.createElementNS('http://www.w3.org/2000/svg', t); }",
  "",
  "function initCase(section, D) {",
  "  var svg = section.querySelector('.board');",
  "  var statusEl = section.querySelector('.status');",
  "  var logEl = section.querySelector('.log');",
  "  var arrowLayer = svg.querySelector('.arrow-layer');",
  "  var ballEl = svg.querySelector('[data-ball]');",
  "  var hexEls = {};",
  "  svg.querySelectorAll('.hex').forEach(function (el) { hexEls[el.dataset.key] = el; });",
  "  var SIZE = D.size;",
  "",
  "  var armed = false;",
  "  var busy = false;",
  "  var curSeed = D.seed | 0;",
  "  var ballKey = D.carrierAt;",
  "",
  "  function place(el, key) {",
  "    var q = toPixel(key, SIZE);",
  "    el.setAttribute('transform', 'translate(' + q.x.toFixed(2) + ' ' + q.y.toFixed(2) + ')');",
  "  }",
  "  function placeXY(el, x, y) {",
  "    el.setAttribute('transform', 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')');",
  "  }",
  "",
  "  function clearHexes() {",
  "    Object.keys(hexEls).forEach(function (k) {",
  "      hexEls[k].classList.remove('target', 'blocked', 'threat', 'carrier');",
  "    });",
  "  }",
  "  function paint() {",
  "    clearHexes();",
  "    arrowLayer.replaceChildren();",
  "    if (hexEls[ballKey]) hexEls[ballKey].classList.add('carrier');",
  "    if (!armed) return;",
  "    D.blocked.forEach(function (k) { if (hexEls[k]) hexEls[k].classList.add('blocked'); });",
  "    D.targets.forEach(function (k) { if (hexEls[k]) hexEls[k].classList.add('target'); });",
  "  }",
  "",
  "  function drawArrow(keys, color) {",
  "    arrowLayer.replaceChildren();",
  "    if (keys.length < 2) return;",
  "    var pts = keys.map(function (k) { return toPixel(k, SIZE); });",
  "    var poly = svgEl('polyline');",
  "    poly.setAttribute('points', pts.map(function (q) { return q.x.toFixed(2)+','+q.y.toFixed(2); }).join(' '));",
  "    poly.setAttribute('fill', 'none');",
  "    poly.setAttribute('stroke', color);",
  "    poly.setAttribute('stroke-width', (SIZE * 0.15).toFixed(2));",
  "    poly.setAttribute('stroke-linecap', 'round');",
  "    poly.setAttribute('stroke-linejoin', 'round');",
  "    arrowLayer.appendChild(poly);",
  "    var a = pts[pts.length - 2], b = pts[pts.length - 1];",
  "    var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;",
  "    var ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;",
  "    var hl = SIZE * 0.5, hw = SIZE * 0.3;",
  "    var bx = b.x - ux * hl, by = b.y - uy * hl;",
  "    var head = svgEl('polygon');",
  "    head.setAttribute('points', [",
  "      b.x.toFixed(2)+','+b.y.toFixed(2),",
  "      (bx - uy*hw).toFixed(2)+','+(by + ux*hw).toFixed(2),",
  "      (bx + uy*hw).toFixed(2)+','+(by - ux*hw).toFixed(2)",
  "    ].join(' '));",
  "    head.setAttribute('fill', color);",
  "    arrowLayer.appendChild(head);",
  "  }",
  "",
  "  function ends(keys) { return [keys[0], keys[keys.length - 1]]; }",
  "  function preview(tk) {",
  "    var lane = D.lanes[tk];",
  "    if (!lane) return;",
  "    drawArrow(ends(lane.hexes), lane.threats.length ? D.danger : D.arrow);",
  "    lane.threats.forEach(function (k) { if (hexEls[k]) hexEls[k].classList.add('threat'); });",
  "  }",
  "",
  "  // The ball flies the STRAIGHT arrow (carrier -> target), not the supercover",
  "  // lane. The lane only says which opponent is first reached at which fraction",
  "  // of that straight flight; each rolls once, in order, first >= interceptOn",
  "  // picks it off (rng advances for every roll, matching the module reducer).",
  "  function firePass(tk) {",
  "    if (busy || !armed) return;",
  "    var lane = D.lanes[tk];",
  "    if (!lane) return;",
  "    busy = true; armed = false;",
  "    clearHexes();",
  "    drawArrow(ends(lane.hexes), lane.threats.length ? D.danger : D.arrow);",
  "    logEl.textContent = '';",
  "    statusEl.textContent = 'pass \\u2192 ' + tk;",
  "    var rng = curSeed | 0;",
  "    var rollLog = [];",
  "    var span = Math.max(1, lane.hexes.length - 1);",
  "    var a = toPixel(D.carrierAt, SIZE), b = toPixel(tk, SIZE);",
  "    var from = a, to = b, dur = span * D.stepMs;",
  "    var nextRoll = 0, picked = null, phase = 0, t0 = 0;",
  "    function frame(now) {",
  "      if (!t0) t0 = now;",
  "      var u = dur > 0 ? (now - t0) / dur : 1;",
  "      if (u > 1) u = 1;",
  "      placeXY(ballEl, from.x + (to.x - from.x) * u, from.y + (to.y - from.y) * u);",
  "      if (phase === 0 && !picked) {",
  "        while (nextRoll < lane.rolls.length &&",
  "               lane.rolls[nextRoll].atIndex / span <= u + 1e-9) {",
  "          var r = lane.rolls[nextRoll++];",
  "          var res = rollDie(rng, D.interceptDie); rng = res[1];",
  "          rollLog.push('d6 ' + res[0]);",
  "          if (picked === null && res[0] >= D.interceptOn) picked = r;",
  "        }",
  "        if (picked) {",
  "          from = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };",
  "          to = toPixel(picked.at, SIZE);",
  "          dur = D.stepMs; t0 = 0; phase = 1;",
  "          requestAnimationFrame(frame); return;",
  "        }",
  "      }",
  "      if (u >= 1) {",
  "        if (phase === 1) { ballKey = picked.at; finish('intercepted by ' + picked.id, rollLog); }",
  "        else { ballKey = tk; finish(lane.receiver ? 'received by ' + lane.receiver : 'loose ball', rollLog); }",
  "        return;",
  "      }",
  "      requestAnimationFrame(frame);",
  "    }",
  "    requestAnimationFrame(frame);",
  "  }",
  "",
  "  function finish(result, rollLog) {",
  "    busy = false;",
  "    var dice = rollLog.length ? '  \\u00b7  ' + rollLog.join(', ') : '  \\u00b7  no defender on the lane';",
  "    logEl.textContent = 'pass \\u2014 ' + result + dice;",
  "    statusEl.textContent = '';",
  "    paint();",
  "  }",
  "",
  "  function restore(seed) {",
  "    busy = false; armed = false;",
  "    curSeed = seed | 0;",
  "    ballKey = D.carrierAt;",
  "    place(ballEl, ballKey);",
  "    D.pieces.forEach(function (p, i) { place(pieceEls[i], p.at); });",
  "    logEl.textContent = '';",
  "    statusEl.textContent = '';",
  "    paint();",
  "  }",
  "",
  "  var pieceEls = svg.querySelectorAll('.piece');",
  "",
  "  Object.keys(hexEls).forEach(function (k) {",
  "    hexEls[k].addEventListener('click', function () {",
  "      if (busy) return;",
  "      if (k === ballKey) { armed = !armed; paint(); return; }",
  "      if (armed && D.targets.indexOf(k) >= 0) { firePass(k); return; }",
  "      armed = false; paint();",
  "    });",
  "    hexEls[k].addEventListener('mouseenter', function () {",
  "      if (busy || !armed || D.targets.indexOf(k) < 0) return;",
  "      paint();",
  "      preview(k);",
  "    });",
  "    hexEls[k].addEventListener('mouseleave', function () {",
  "      if (busy || !armed) return;",
  "      paint();",
  "    });",
  "  });",
  "  section.querySelector('.reset').addEventListener('click', function () { restore(curSeed); });",
  "  section.querySelector('.shuffle').addEventListener('click', function () {",
  "    restore((Math.random() * 2147483647) | 0);",
  "  });",
  "",
  "  place(ballEl, ballKey);",
  "  paint();",
  "}",
  "CASES.forEach(function (c) { initCase(document.getElementById(c.id), c.data); });",
].join("\n");

/**
 * Render every {@link PassCase} onto one interactive page at
 * `scenarios/actions/passing/index.html` and register it on the landing nav.
 * Returns the page HTML.
 */
export function writePassPlayground(
  slug: string,
  label: string,
  blurb: string,
  cases: readonly PassCase[],
  opts?: RenderOptions,
): string {
  const size = opts?.size ?? DEFAULT_HEX_SIZE;
  const rendered = cases.map((c, i) => renderCase(`case-${i}`, c, size));
  const manifest = rendered.map((r, i) => ({
    id: `case-${i}`,
    data: {
      ...r.data,
      stepMs: STEP_MS,
      arrow: COLOR.arrow,
      danger: COLOR.danger,
    },
  }));

  const body =
    `  <a class="back" href="../../index.html">&larr; all scenarios</a>\n` +
    `  <h1>${escapeHtml(label)}</h1>\n` +
    `  <p class="lede">${escapeHtml(blurb)} Click the piece on the ball to ` +
    `arm the pass — legal targets fill blue, hexes an opponent's <em>shadow</em> ` +
    `blocks stay grey. Hover a target for the lane; a lane an opponent flanks ` +
    `reddens and its hexes pulse. Click to kick — the ball flies the straight ` +
    `arrow and every flanking opponent rolls a d6 as it passes (a 6 picks it off). ` +
    `<strong>reset</strong> replays the seed, <strong>shuffle</strong> rolls a ` +
    `fresh one.</p>\n` +
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
