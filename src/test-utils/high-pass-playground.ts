import { cubeKey, type Cube } from "../coordinates/coordinates.js";
import { cubeToPixel, DEFAULT_HEX_SIZE } from "../layout/layout.js";
import { reachableCubes } from "../movement/movement.js";
import {
  blockersFor,
  type MoveActionState,
  type Piece,
} from "../move-action/move-action.js";
import {
  highPassLandingZone,
  highPassRangeCubes,
  highPassReceivers,
  highPassShadow,
  highPassTargets,
} from "../high-pass/high-pass.js";
import { ballMarker, disc, hexCorners, playerMarker } from "./board.js";
import { actionPage, registerActionGroup } from "./gallery.js";
import type { RenderOptions } from "./render-scenario.js";

/** Palette shared with the static renderer. */
const COLOR = {
  empty: "#e8e8e8",
  target: "#bcd8ff",
  targetHover: "#93c2ff",
  blocked: "#cfcfcf",
  box: "#f3e2b8",
  reach: "#c7ecd0",
  pick: "#ffd27a",
  ring: "#d9c4f2",
  grid: "#999",
  arrow: "#2d9cdb",
  danger: "#d33",
} as const;

const TEAM_COLORS = ["#d33", "#2478c9"] as const;
const STEP_MS = 150;
const KEEPER_CHALLENGE_RANGE = 5;

/** A piece on a high-pass board. */
export interface HighPassPiece {
  at: Cube;
  label: string | number;
  team: string;
  /** `"goalkeeper"` uses `aerial` in the header and gets the box reaction. */
  role?: "goalkeeper";
  /** Marks the passer. Exactly one per board. */
  hasBall?: boolean;
  /** Aerial contest attr — `heading`, or `aerial` for a keeper. Default 3. */
  heading?: number;
  /** Loft accuracy — carrier only. `d6 + highPass >= accuracyOn`. Default 3. */
  highPass?: number;
}

/** One titled board on the high-pass page. */
export interface HighPassCase {
  title: string;
  radius: number;
  pieces: readonly HighPassPiece[];
  penaltyArea?: readonly Cube[];
  /** Loft reach in adjacent-hex spacings. Default 8. */
  highPassRange?: number;
  /** `d6 + highPass` at or above this is accurate. Default 8. */
  highPassAccuracyOn?: number;
  /** Fixed dice seed; `reset` returns to it. Default derived from the case id. */
  seed?: number;
}

interface PieceData {
  id: string;
  at: string;
  label: string;
  color: string;
  team: string;
  role: string;
  hdr: number;
}

interface ReceiverData {
  zone: string[];
  /** Landing hexes the receiver can run to. */
  targets: string[];
  /** Hexes inside the receiver's run + the range disc, but shadowed out. */
  blocked: string[];
}

interface CaseData {
  size: number;
  board: string[];
  penaltyArea: string[];
  pieces: PieceData[];
  carrierId: string;
  carrierAt: string;
  carrierHighPass: number;
  carrierTeam: string;
  receivers: string[];
  perReceiver: Record<string, ReceiverData>;
  shadow: string[];
  accuracyOn: number;
  seed: number;
}

const f = (n: number): string => n.toFixed(2);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h | 0) || 1;
}

function toState(c: HighPassCase): {
  state: MoveActionState;
  carrier: Piece;
  pieces: Piece[];
} {
  const pieces: Piece[] = c.pieces.map((p, i) => {
    const attrs: NonNullable<Piece["attrs"]> = {};
    if (p.heading != null) {
      attrs.heading = p.heading;
      attrs.aerial = p.heading;
    }
    if (p.highPass != null) attrs.highPass = p.highPass;
    const piece: Piece = {
      id: `p${i}`,
      label: p.label,
      at: p.at,
      movePoints: 3,
      team: p.team,
      attrs,
    };
    if (p.role) piece.role = p.role;
    return piece;
  });
  const ci = Math.max(
    0,
    c.pieces.findIndex((p) => p.hasBall),
  );
  const state: MoveActionState = {
    pieces,
    obstacles: [],
    ball: pieces[ci]!.at,
    highPassRange: c.highPassRange ?? 8,
    highPassAccuracyOn: c.highPassAccuracyOn ?? 8,
    penaltyArea: c.penaltyArea ?? [],
  };
  return { state, carrier: pieces[ci]!, pieces };
}

function renderCase(
  id: string,
  c: HighPassCase,
  size: number,
): { section: string; data: CaseData } {
  const { state, carrier, pieces } = toState(c);

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

  const teamOrder: string[] = [carrier.team];
  const colorFor = (team: string): string => {
    let idx = teamOrder.indexOf(team);
    if (idx < 0) idx = teamOrder.push(team) - 1;
    return TEAM_COLORS[idx % TEAM_COLORS.length]!;
  };

  const pieceEls: string[] = [];
  const pieceData: PieceData[] = [];
  pieces.forEach((p, i) => {
    const q = cubeToPixel(p.at, size);
    const color = colorFor(p.team);
    pieceEls.push(
      `        <g class="piece" data-piece="${i}" ` +
        `transform="translate(${f(q.x)} ${f(q.y)})">\n` +
        `          ${playerMarker(size, color, p.label)}\n` +
        `        </g>`,
    );
    pieceData.push({
      id: p.id,
      at: cubeKey(p.at),
      label: String(p.label),
      color,
      team: p.team,
      role: p.role ?? "outfield",
      hdr: p.attrs?.heading ?? state.defaultAttr ?? 3,
    });
  });

  const carrierQ = cubeToPixel(carrier.at, size);
  const ballEl =
    `        <g class="ball-layer" data-ball ` +
    `transform="translate(${f(carrierQ.x)} ${f(carrierQ.y)})">\n` +
    `          ${ballMarker(size, id)}\n` +
    `        </g>`;

  const zoneKeys = highPassLandingZone(state, carrier.id).map(cubeKey);
  const discSet = new Set(
    highPassRangeCubes(state, carrier.id).map(cubeKey),
  );
  const perReceiver: Record<string, ReceiverData> = {};
  for (const r of highPassReceivers(state, carrier.id)) {
    const targets = highPassTargets(state, carrier.id, r.id).map(cubeKey);
    const targetSet = new Set(targets);
    // the shadowed slice of the receiver's run: hexes it could reach that sit in
    // the range disc but are shaded out (so not a legal target).
    const blocked = reachableCubes(
      r.at,
      3,
      blockersFor(state, r.id),
    )
      .map(cubeKey)
      .filter((k) => discSet.has(k) && !targetSet.has(k));
    perReceiver[r.id] = { zone: zoneKeys, targets, blocked };
  }

  const data: CaseData = {
    size,
    board: hexes.map(cubeKey),
    penaltyArea: (c.penaltyArea ?? []).map(cubeKey),
    pieces: pieceData,
    carrierId: carrier.id,
    carrierAt: cubeKey(carrier.at),
    carrierHighPass: carrier.attrs?.highPass ?? state.defaultAttr ?? 3,
    carrierTeam: carrier.team,
    receivers: highPassReceivers(state, carrier.id).map((p) => p.id),
    perReceiver,
    shadow: highPassShadow(state, carrier.id).map(cubeKey),
    accuracyOn: state.highPassAccuracyOn!,
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
    `        <button class="skip" type="button" hidden>skip</button>\n` +
    `        <button class="reset" type="button">reset</button>\n` +
    `        <button class="shuffle" type="button">shuffle</button>\n` +
    `      </div>\n` +
    `      <p class="log"></p>\n` +
    `    </section>`;

  return { section, data };
}

const CASES_CSS = `
  .lede { max-width: 48rem; }
  .cases { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: start; }
  .case { border: 1px solid #e2e2e2; border-radius: 8px; padding: .75rem;
    background: #fff; width: 420px; }
  .case h2 { margin: 0 0 .5rem; font-size: .9rem; }
  .board { display: block; width: 100%; height: auto; touch-action: none; }
  .hex { fill: ${COLOR.empty}; stroke: ${COLOR.grid}; stroke-width: 1; }
  .hex.box { fill: ${COLOR.box}; }
  .hex.blocked { fill: ${COLOR.blocked}; }
  .hex.target { fill: ${COLOR.target}; cursor: pointer; }
  .hex.target:hover { fill: ${COLOR.targetHover}; }
  .hex.reach { fill: ${COLOR.reach}; cursor: pointer; }
  .hex.ring { fill: ${COLOR.ring}; }
  .hex.carrier, .hex.pickable { cursor: pointer; }
  .piece.glow .marker.player circle { stroke: #111; stroke-width: 2.4; }
  .piece.win .marker.player circle { stroke: #1a7f37; stroke-width: 3.2; }
  .piece.shut { opacity: .32; }
  .arrow-layer, .ball-layer { pointer-events: none; }
  .piece { pointer-events: none; }
  .piece.pickable { pointer-events: all; cursor: pointer; }
  .hud { display: flex; align-items: center; gap: .5rem; margin-top: .5rem;
    font-size: .8rem; color: #666; }
  .status { flex: 1; font-variant-numeric: tabular-nums; }
  .skip, .reset, .shuffle { font: inherit; padding: .1rem .5rem; cursor: pointer;
    border: 1px solid #ccc; background: #f4f4f4; border-radius: 4px; }
  .log { margin: .4rem 0 0; font-size: .78rem; color: #444; min-height: 2.4em;
    white-space: pre-line; font-variant-numeric: tabular-nums; }`;

/**
 * The live layer, once per page. Every static hex set (landing zone, per-receiver
 * targets, shadow) is **baked** from the real `high-pass` module; the script
 * mirrors only the seeded d6 (mulberry32, matching `src/dice`), a BFS reachable
 * for the reaction moves, the `looseBall` scatter and the header contest. No
 * backticks / `${` so it embeds verbatim.
 */
const SCRIPT = [
  "function parse(k) { return k.split(',').map(Number); }",
  "function key(p) { return p[0] + ',' + p[1] + ',' + p[2]; }",
  "function toPixel(k, size) {",
  "  var p = parse(k);",
  "  return { x: size * Math.sqrt(3) * (p[0] + p[2] / 2), y: size * 1.5 * p[2] };",
  "}",
  "var DIRS = [[1,-1,0],[1,0,-1],[0,1,-1],[-1,1,0],[-1,0,1],[0,-1,1]];",
  "function dist(a, b) {",
  "  var pa = parse(a), pb = parse(b);",
  "  return (Math.abs(pa[0]-pb[0]) + Math.abs(pa[1]-pb[1]) + Math.abs(pa[2]-pb[2])) / 2;",
  "}",
  "function bfs(from, budget, blocked, boardSet) {",
  "  var seen = {}; seen[from] = true;",
  "  var frontier = [from]; var out = [];",
  "  for (var d = 0; d < budget; d++) {",
  "    var next = [];",
  "    for (var i = 0; i < frontier.length; i++) {",
  "      var pp = parse(frontier[i]);",
  "      for (var j = 0; j < DIRS.length; j++) {",
  "        var nk = key([pp[0]+DIRS[j][0], pp[1]+DIRS[j][1], pp[2]+DIRS[j][2]]);",
  "        if (seen[nk] || blocked[nk] || !boardSet[nk]) continue;",
  "        seen[nk] = true; out.push(nk); next.push(nk);",
  "      }",
  "    }",
  "    frontier = next;",
  "  }",
  "  return out;",
  "}",
  "// Shortest hex path from -> to within budget, or null (BFS with parents).",
  "function bfsPath(from, to, blocked, boardSet, budget) {",
  "  if (from === to) return [from];",
  "  var prev = {}; prev[from] = null;",
  "  var frontier = [from];",
  "  for (var d = 0; d < budget; d++) {",
  "    var next = [];",
  "    for (var i = 0; i < frontier.length; i++) {",
  "      var pp = parse(frontier[i]);",
  "      for (var j = 0; j < DIRS.length; j++) {",
  "        var nk = key([pp[0]+DIRS[j][0], pp[1]+DIRS[j][1], pp[2]+DIRS[j][2]]);",
  "        if (prev.hasOwnProperty(nk) || blocked[nk] || !boardSet[nk]) continue;",
  "        prev[nk] = frontier[i];",
  "        if (nk === to) {",
  "          var path = [nk], c = frontier[i];",
  "          while (c !== null) { path.unshift(c); c = prev[c]; }",
  "          return path;",
  "        }",
  "        next.push(nk);",
  "      }",
  "    }",
  "    frontier = next;",
  "  }",
  "  return null;",
  "}",
  "// mulberry32, matching src/dice: [value, nextState]",
  "function nextRandom(s) {",
  "  var a = (s + 0x6d2b79f5) | 0;",
  "  var t = Math.imul(a ^ (a >>> 15), 1 | a);",
  "  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
  "  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];",
  "}",
  "function rollDie(s) { var r = nextRandom(s); return [Math.floor(r[0]*6)+1, r[1]]; }",
  "function svgEl(t) { return document.createElementNS('http://www.w3.org/2000/svg', t); }",
  "",
  "function initCase(section, D) {",
  "  var svg = section.querySelector('.board');",
  "  var statusEl = section.querySelector('.status');",
  "  var logEl = section.querySelector('.log');",
  "  var skipBtn = section.querySelector('.skip');",
  "  var arrowLayer = svg.querySelector('.arrow-layer');",
  "  var ballEl = svg.querySelector('[data-ball]');",
  "  var pieceEls = svg.querySelectorAll('.piece');",
  "  var hexEls = {};",
  "  svg.querySelectorAll('.hex').forEach(function (el) { hexEls[el.dataset.key] = el; });",
  "  var SIZE = D.size;",
  "  var STEP_MS = " +
    STEP_MS +
    ";",
  "  var boardSet = {}; D.board.forEach(function (k) { boardSet[k] = true; });",
  "",
  "  var phase, receiverId, target, pos, queue, qi, curSeed, log, busy;",
  "",
  "  function pieceElById(pid) {",
  "    for (var i = 0; i < D.pieces.length; i++) if (D.pieces[i].id === pid) return pieceEls[i];",
  "    return null;",
  "  }",
  "  function occupied(exceptId) {",
  "    var b = {};",
  "    D.pieces.forEach(function (p) { if (p.id !== exceptId) b[pos[p.id]] = true; });",
  "    return b;",
  "  }",
  "  function place(el, k) {",
  "    var q = toPixel(k, SIZE);",
  "    el.setAttribute('transform', 'translate(' + q.x.toFixed(2) + ' ' + q.y.toFixed(2) + ')');",
  "  }",
  "  function placeXY(el, x, y) {",
  "    el.setAttribute('transform', 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')');",
  "  }",
  "  // Walk `el` hex-by-hex along `keys` (a path), then call `done`.",
  "  function animateWalk(el, keys, done) {",
  "    var i = 0;",
  "    function seg() {",
  "      if (!keys || i >= keys.length - 1) { done(); return; }",
  "      var a = toPixel(keys[i], SIZE), b = toPixel(keys[i + 1], SIZE), t0 = 0;",
  "      function frame(now) {",
  "        if (!t0) t0 = now;",
  "        var u = (now - t0) / STEP_MS; if (u > 1) u = 1;",
  "        placeXY(el, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);",
  "        if (u >= 1) { i++; seg(); return; }",
  "        requestAnimationFrame(frame);",
  "      }",
  "      requestAnimationFrame(frame);",
  "    }",
  "    seg();",
  "  }",
  "",
  "  function clearHexes() {",
  "    Object.keys(hexEls).forEach(function (k) {",
  "      hexEls[k].className.baseVal = 'hex' + (D.penaltyArea.indexOf(k) >= 0 ? ' box' : '');",
  "    });",
  "  }",
  "  function clearPieces() {",
  "    pieceEls.forEach(function (el) { el.classList.remove('glow', 'win', 'pickable', 'shut'); });",
  "  }",
  "",
  "  function paint() {",
  "    clearHexes();",
  "    clearPieces();",
  "    arrowLayer.replaceChildren();",
  "    skipBtn.hidden = true;",
  "    if (phase === 'idle') {",
  "      hexEls[pos[D.carrierId]].classList.add('carrier');",
  "      statusEl.textContent = 'click the passer';",
  "    } else if (phase === 'receiver') {",
  "      D.shadow.forEach(function (k) { if (hexEls[k]) hexEls[k].classList.add('blocked'); });",
  "      D.pieces.forEach(function (p) {",
  "        if (p.team !== D.carrierTeam || p.id === D.carrierId) return;",
  "        var el = pieceElById(p.id);",
  "        if (D.receivers.indexOf(p.id) >= 0) el.classList.add('glow', 'pickable');",
  "        else el.classList.add('shut');",
  "      });",
  "      var shut = D.pieces.filter(function (p) {",
  "        return p.team === D.carrierTeam && p.id !== D.carrierId && D.receivers.indexOf(p.id) < 0;",
  "      }).length;",
  "      statusEl.textContent = 'pick a receiver (highlighted)' +",
  "        (shut ? ' \\u2014 ' + shut + ' shut out by a marker' : '');",
  "    } else if (phase === 'aiming') {",
  "      var rec = D.perReceiver[receiverId];",
  "      rec.blocked.forEach(function (k) { if (hexEls[k]) hexEls[k].classList.add('blocked'); });",
  "      rec.targets.forEach(function (k) { if (hexEls[k]) hexEls[k].classList.add('target'); });",
  "      var rel = pieceElById(receiverId); if (rel) rel.classList.add('glow');",
  "      statusEl.textContent = rec.blocked.length",
  "        ? 'hover a blue hex, click to loft \\u2014 grey = shadowed out of reach'",
  "        : 'hover a blue hex, click to loft';",
  "    } else if (phase === 'reacting') {",
  "      paintReaction();",
  "    }",
  "  }",
  "",
  "  function paintReaction() {",
  "    var slot = queue[qi];",
  "    drawArc(pos[D.carrierId], target, D.arrow, 0.5);",
  "    if (hexEls[target]) hexEls[target].classList.add('target');",
  "    if (slot.role === 'opponent' && !slot.id) {",
  "      slot.candidates.forEach(function (cid) {",
  "        var el = pieceElById(cid); if (el) el.classList.add('glow', 'pickable');",
  "      });",
  "      statusEl.textContent = 'reaction — click an opponent to move';",
  "      skipBtn.hidden = false;",
  "      return;",
  "    }",
  "    var el = pieceElById(slot.id); if (el) el.classList.add('glow');",
  "    var reach = bfs(pos[slot.id], slot.budget, occupied(slot.id), boardSet);",
  "    reach.forEach(function (k) { if (hexEls[k]) hexEls[k].classList.add('reach'); });",
  "    slot._reach = reach;",
  "    statusEl.textContent = slot.role + ' reaction — click a hex (' + slot.budget + '), or skip';",
  "    skipBtn.hidden = false;",
  "  }",
  "",
  "  function drawArc(fromK, toK, color, bow) {",
  "    var a = toPixel(fromK, SIZE), b = toPixel(toK, SIZE);",
  "    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;",
  "    var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;",
  "    var lift = len * (bow || 0.28);",
  "    var path = svgEl('path');",
  "    path.setAttribute('d', 'M ' + a.x.toFixed(2) + ' ' + a.y.toFixed(2) +",
  "      ' Q ' + mx.toFixed(2) + ' ' + (my - lift).toFixed(2) +",
  "      ' ' + b.x.toFixed(2) + ' ' + b.y.toFixed(2));",
  "    path.setAttribute('fill', 'none');",
  "    path.setAttribute('stroke', color);",
  "    path.setAttribute('stroke-width', (SIZE * 0.12).toFixed(2));",
  "    path.setAttribute('stroke-linecap', 'round');",
  "    arrowLayer.replaceChildren(path);",
  "  }",
  "",
  "  function lockTarget(k) {",
  "    target = k;",
  "    var slots = [",
  "      { role: 'receiver', id: receiverId, budget: 3 },",
  "      { role: 'opponent', id: null, budget: 3 }",
  "    ];",
  "    var inBox = D.penaltyArea.indexOf(k) >= 0;",
  "    var keeper = null;",
  "    D.pieces.forEach(function (p) {",
  "      if (p.team !== D.carrierTeam && p.role === 'goalkeeper') keeper = p;",
  "    });",
  "    if (inBox && keeper) {",
  "      slots.push({ role: 'keeper', id: keeper.id,",
  "        budget: dist(pos[keeper.id], k) <= " +
    KEEPER_CHALLENGE_RANGE +
    " ? 4 : 1 });",
  "    }",
  "    var hasKeeper = inBox && keeper;",
  "    slots[1].candidates = D.pieces.filter(function (p) {",
  "      return p.team !== D.carrierTeam && !(hasKeeper && p.role === 'goalkeeper');",
  "    }).map(function (p) { return p.id; });",
  "    queue = slots; qi = 0; phase = 'reacting';",
  "    log = [];",
  "    // the receiver runs straight onto the landing hex — routed around the",
  "    // other players (reachableCubes semantics). Manual only if it is boxed in.",
  "    var run = bfsPath(pos[receiverId], target, occupied(receiverId), boardSet, slots[0].budget);",
  "    clearHexes(); clearPieces();",
  "    if (hexEls[target]) hexEls[target].classList.add('target');",
  "    drawArc(pos[D.carrierId], target, D.arrow, 0.28);",
  "    if (run) {",
  "      busy = true;",
  "      statusEl.textContent = 'receiver runs onto the ball\\u2026';",
  "      animateWalk(pieceElById(receiverId), run, function () {",
  "        pos[receiverId] = target;",
  "        log.push('receiver \\u2192 runs onto ' + target);",
  "        busy = false; qi = 1; paint();",
  "      });",
  "    } else {",
  "      paint();",
  "    }",
  "  }",
  "",
  "  function advanceReaction() {",
  "    qi++;",
  "    if (qi >= queue.length) { kick(); return; }",
  "    paint();",
  "  }",
  "",
  "  function moveReactor(slot, k) {",
  "    var route = bfsPath(pos[slot.id], k, occupied(slot.id), boardSet, slot.budget);",
  "    busy = true;",
  "    clearHexes(); clearPieces();",
  "    if (hexEls[target]) hexEls[target].classList.add('target');",
  "    drawArc(pos[D.carrierId], target, D.arrow, 0.28);",
  "    animateWalk(pieceElById(slot.id), route || [pos[slot.id], k], function () {",
  "      pos[slot.id] = k; busy = false; advanceReaction();",
  "    });",
  "  }",
  "",
  "  function kick() {",
  "    phase = 'flying';",
  "    clearHexes(); clearPieces(); skipBtn.hidden = true;",
  "    var rng = curSeed | 0;",
  "    var ar = rollDie(rng); rng = ar[1];",
  "    var accScore = ar[0] + D.carrierHighPass;",
  "    var accurate = accScore >= D.accuracyOn;",
  "    log.push('loft \\u2014 d6 ' + ar[0] + ' + highPass ' + D.carrierHighPass +",
  "      ' = ' + accScore + (accurate ? ' \\u2192 accurate' : ' \\u2192 wide'));",
  "    var arrival = target;",
  "    if (!accurate) {",
  "      var dr = rollDie(rng); rng = dr[1];",
  "      var ds = rollDie(rng); rng = ds[1];",
  "      var dir = DIRS[dr[0] - 1];",
  "      var tp = parse(target);",
  "      arrival = key([tp[0] + dir[0]*ds[0], tp[1] + dir[1]*ds[0], tp[2] + dir[2]*ds[0]]);",
  "      log.push('   scatter \\u2014 d6 dir ' + dr[0] + ', d6 dist ' + ds[0] +",
  "        ' \\u2192 lands ' + arrival);",
  "    }",
  "    animateArc(pos[D.carrierId], arrival, function () { header(arrival, rng); });",
  "  }",
  "",
  "  function animateArc(fromK, toK, done) {",
  "    var a = toPixel(fromK, SIZE), b = toPixel(toK, SIZE);",
  "    var span = Math.max(1, dist(fromK, toK));",
  "    var dur = span * " +
    STEP_MS +
    ", t0 = 0;",
  "    var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;",
  "    var lift = len * 0.28;",
  "    function frame(now) {",
  "      if (!t0) t0 = now;",
  "      var u = dur > 0 ? (now - t0) / dur : 1; if (u > 1) u = 1;",
  "      var hop = Math.sin(Math.PI * u) * lift;",
  "      placeXY(ballEl, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u - hop);",
  "      if (u >= 1) { done(); return; }",
  "      requestAnimationFrame(frame);",
  "    }",
  "    requestAnimationFrame(frame);",
  "  }",
  "",
  "  function header(arrival, rng) {",
  "    phase = 'done';",
  "    var field = [arrival, ...bfs(arrival, 2, {}, boardSet)];",
  "    var fieldSet = {}; field.forEach(function (k) { fieldSet[k] = true; });",
  "    field.forEach(function (k) {",
  "      if (hexEls[k]) hexEls[k].classList.add(dist(k, arrival) === 2 ? 'ring' : 'target');",
  "    });",
  "    var rolls = [];",
  "    D.pieces.forEach(function (p) {",
  "      var d = dist(pos[p.id], arrival);",
  "      if (d > 2) return;",
  "      var r = rollDie(rng); rng = r[1];",
  "      var attr = d === 2 ? p.hdr - 1 : p.hdr;",
  "      rolls.push({ id: p.id, label: p.label, d: d, roll: r[0], score: r[0] + attr,",
  "        note: 'd6 ' + r[0] + '+' + attr + (d === 2 ? '(-1)' : '') + '=' + (r[0] + attr) });",
  "    });",
  "    rolls.sort(function (x, y) { return x.d - y.d; });",
  "    var winner = null;",
  "    if (rolls.length) {",
  "      var top = Math.max.apply(null, rolls.map(function (r) { return r.score; }));",
  "      var lead = rolls.filter(function (r) { return r.score === top; });",
  "      if (lead.length === 1) winner = lead[0].id;",
  "    }",
  "    if (rolls.length) {",
  "      log.push('header \\u2014 ' + rolls.map(function (r) { return r.label + ' ' + r.note; }).join('  \\u00b7  ') +",
  "        ' \\u2192 ' + (winner ? (rolls.filter(function(r){return r.id===winner;})[0].label + ' wins') : 'loose'));",
  "    } else {",
  "      log.push('header \\u2014 nobody near \\u2192 loose ball');",
  "    }",
  "    if (winner) {",
  "      var el = pieceElById(winner); if (el) el.classList.add('win');",
  "    }",
  "    statusEl.textContent = winner ? 'headed' : 'loose ball';",
  "    logEl.textContent = log.join('\\n');",
  "  }",
  "",
  "  function restore(seed) {",
  "    phase = 'idle'; receiverId = null; target = null; queue = null; qi = 0;",
  "    busy = false; curSeed = seed | 0; log = [];",
  "    pos = {}; D.pieces.forEach(function (p) { pos[p.id] = p.at; });",
  "    D.pieces.forEach(function (p, i) { place(pieceEls[i], p.at); });",
  "    place(ballEl, D.carrierAt);",
  "    logEl.textContent = '';",
  "    paint();",
  "  }",
  "",
  "  Object.keys(hexEls).forEach(function (k) {",
  "    hexEls[k].addEventListener('click', function () {",
  "      if (busy) return;",
  "      if (phase === 'idle' && k === pos[D.carrierId]) { phase = 'receiver'; paint(); return; }",
  "      if (phase === 'aiming' && D.perReceiver[receiverId].targets.indexOf(k) >= 0) {",
  "        lockTarget(k); return;",
  "      }",
  "      if (phase === 'reacting') {",
  "        var slot = queue[qi];",
  "        if (slot.id && slot._reach && slot._reach.indexOf(k) >= 0) {",
  "          moveReactor(slot, k); return;",
  "        }",
  "      }",
  "    });",
  "    hexEls[k].addEventListener('mouseenter', function () {",
  "      if (busy || phase !== 'aiming') return;",
  "      if (D.perReceiver[receiverId].targets.indexOf(k) < 0) return;",
  "      drawArc(pos[D.carrierId], k, D.arrow, 0.28);",
  "    });",
  "    hexEls[k].addEventListener('mouseleave', function () {",
  "      if (phase === 'aiming') arrowLayer.replaceChildren();",
  "    });",
  "  });",
  "",
  "  pieceEls.forEach(function (el, i) {",
  "    el.addEventListener('click', function () {",
  "      if (busy) return;",
  "      var p = D.pieces[i];",
  "      if (phase === 'receiver' && D.receivers.indexOf(p.id) >= 0) {",
  "        receiverId = p.id; phase = 'aiming'; paint(); return;",
  "      }",
  "      if (phase === 'reacting') {",
  "        var slot = queue[qi];",
  "        if (slot.role === 'opponent' && !slot.id && slot.candidates.indexOf(p.id) >= 0) {",
  "          slot.id = p.id; paint(); return;",
  "        }",
  "      }",
  "    });",
  "  });",
  "",
  "  // Right-click steps the selection back: aiming -> receiver -> idle.",
  "  svg.addEventListener('contextmenu', function (e) {",
  "    e.preventDefault();",
  "    if (busy) return;",
  "    if (phase === 'aiming') { receiverId = null; target = null; phase = 'receiver'; paint(); }",
  "    else if (phase === 'receiver') { phase = 'idle'; paint(); }",
  "  });",
  "",
  "  skipBtn.addEventListener('click', function () {",
  "    if (!busy && phase === 'reacting') advanceReaction();",
  "  });",
  "  section.querySelector('.reset').addEventListener('click', function () { restore(curSeed); });",
  "  section.querySelector('.shuffle').addEventListener('click', function () {",
  "    restore((Math.random() * 2147483647) | 0);",
  "  });",
  "",
  "  restore(D.seed | 0);",
  "}",
  "CASES.forEach(function (c) { initCase(document.getElementById(c.id), c.data); });",
].join("\n");

/**
 * Render every {@link HighPassCase} onto one interactive page at
 * `scenarios/actions/high-pass/index.html` and register it on the landing nav.
 */
export function writeHighPassPlayground(
  slug: string,
  label: string,
  blurb: string,
  cases: readonly HighPassCase[],
  opts?: RenderOptions,
): string {
  const size = opts?.size ?? DEFAULT_HEX_SIZE;
  const rendered = cases.map((c, i) => renderCase(`case-${i}`, c, size));
  const manifest = rendered.map((r, i) => ({
    id: `case-${i}`,
    data: { ...r.data, arrow: COLOR.arrow, danger: COLOR.danger },
  }));

  const body =
    `  <a class="back" href="../../index.html">&larr; all scenarios</a>\n` +
    `  <h1>${escapeHtml(label)}</h1>\n` +
    `  <p class="lede">${escapeHtml(blurb)} Click the passer, then a highlighted ` +
    `receiver (dimmed teammates are shut out by a marker). The hexes it can run ` +
    `onto fill <strong>blue</strong>; hexes of its run a marker <strong>shadows` +
    `</strong> stay <strong>grey</strong>. <strong>Yellow</strong> hexes are the ` +
    `penalty area — the keeper only reacts to a loft landing there. Right-click ` +
    `steps the pick back. Hover a blue hex for the jump arc, click to loft. The ` +
    `receiver walks onto the landing hex; then one opponent (and the keeper in ` +
    `the box) reacts — glows, its reach fills green, click a hex or ` +
    `<strong>skip</strong>. The kick logs the accuracy d6, any scatter and every ` +
    `header roll. <strong>reset</strong> replays the seed, <strong>shuffle</strong> ` +
    `rolls a fresh one.</p>\n` +
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
