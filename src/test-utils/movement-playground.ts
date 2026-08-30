import { cubeKey, type Cube } from "../coordinates/coordinates.js";
import { seedRng } from "../dice/dice.js";
import { cubeToPixel, DEFAULT_HEX_SIZE } from "../layout/layout.js";
import { ballMarker, disc, hexCorners, playerMarker } from "./board.js";
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
  danger: "#d33",
} as const;

/** Fill per team, in first-seen order. */
const TEAM_COLORS = ["#d33", "#2478c9"] as const;

const STEP_MS = 140;

/** A piece the movement action can pick up and walk. */
export interface PlaygroundPiece {
  at: Cube;
  /** Drawn on the disc. */
  label: string | number;
  /** Hexes it may travel — its `movePoints`. */
  movePoints: number;
  /** Which side it is on — exactly two teams per board. */
  team: string;
  /** Marks the ball carrier. At most one piece per board. */
  hasBall?: boolean;
  /** Contest attributes; missing ones fall back to `defaultAttr`. */
  attrs?: { dribbling?: number; tackling?: number };
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
  /** Steal-check die size. Default 6. */
  stealDie?: number;
  /** A steal-check roll at or below this takes the ball. Default 1. */
  stealOn?: number;
  /** Attribute value used when a piece omits one. Default 3. */
  defaultAttr?: number;
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
  ball: string | null;
  stealDie: number;
  stealOn: number;
  defaultAttr: number;
  seed: number;
  pieces: {
    id: string;
    at: string;
    label: string;
    movePoints: number;
    team: string;
    attrs: { dribbling?: number; tackling?: number };
  }[];
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

  const teams: string[] = [];
  for (const piece of p.pieces) {
    if (!teams.includes(piece.team)) teams.push(piece.team);
  }
  const teamColor = (team: string): string =>
    TEAM_COLORS[Math.max(0, teams.indexOf(team)) % TEAM_COLORS.length]!;

  const pieces = p.pieces.map((piece, i) => ({
    id: `${id}-p${i}`,
    at: cubeKey(piece.at),
    label: String(piece.label),
    movePoints: piece.movePoints,
    team: piece.team,
    color: teamColor(piece.team),
    hasBall: piece.hasBall === true,
    attrs: piece.attrs ?? {},
  }));

  const carrier = pieces.find((piece) => piece.hasBall) ?? null;

  const pieceEls = pieces
    .map((piece, i) => {
      const px = cubeToPixel(p.pieces[i]!.at, size);
      return (
        `        <g class="piece" data-id="${piece.id}" data-home="${piece.at}" ` +
        `data-team="${escapeHtml(piece.team)}" ` +
        `transform="translate(${f(px.x)} ${f(px.y)})">` +
        playerMarker(size, piece.color, piece.label) +
        `</g>`
      );
    })
    .join("\n");

  const ballEl = carrier
    ? `\n        <g class="ball" transform="translate(${f(
        cubeToPixel(p.pieces[pieces.indexOf(carrier)]!.at, size).x + size * 0.4,
      )} ${f(
        cubeToPixel(p.pieces[pieces.indexOf(carrier)]!.at, size).y - size * 0.4,
      )})">${ballMarker(size, id)}</g>`
    : "";

  const data: CaseData = {
    size,
    board: hexes.map((h) => cubeKey(h)),
    obstacles: [...obstacleKeys],
    piecesBlock: p.piecesBlock !== false,
    ball: carrier ? carrier.at : null,
    stealDie: p.stealDie ?? 6,
    stealOn: p.stealOn ?? 1,
    defaultAttr: p.defaultAttr ?? 3,
    seed: seedRng(`${id}`),
    pieces: pieces.map(({ id: pid, at, label, movePoints, team, attrs }) => ({
      id: pid,
      at,
      label,
      movePoints,
      team,
      attrs,
    })),
  };

  const section =
    `    <section class="case" id="${id}">\n` +
    `      <h2>${escapeHtml(c.title)}</h2>\n` +
    `      <svg class="board" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">\n` +
    polygons +
    `\n        <g class="arrow-layer"></g>\n` +
    pieceEls +
    ballEl +
    `\n      </svg>\n` +
    `      <div class="hud"><div class="hud-row"><span class="status"></span>` +
    `<span class="hud-btns"><button class="stay" type="button" hidden>stay</button>` +
    `<button class="reset" type="button">reset</button></span></div>` +
    `<p class="log" hidden></p></div>\n` +
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
  .hex.hazard { stroke: ${COLOR.danger}; stroke-width: 3;
    animation: haz 1s ease-in-out infinite; }
  @keyframes haz { 0%,100% { stroke-opacity: .3 } 50% { stroke-opacity: 1 } }
  .hex.relo { fill: #bfe6c4; cursor: pointer; }
  .hex.relo:hover { fill: #93d79c; }
  .arrow-layer { pointer-events: none; }
  .piece { cursor: pointer; transition: transform ${STEP_MS}ms linear; }
  .piece.selected { filter: drop-shadow(0 0 3px #1560c4); }
  .piece.tackle-target { filter: drop-shadow(0 0 3px ${COLOR.danger})
    drop-shadow(0 0 3px ${COLOR.danger}); cursor: crosshair; }
  .piece.caught { filter: drop-shadow(0 0 3px #6a5acd) drop-shadow(0 0 3px #6a5acd); }
  .ball.loose { animation: looseBall 1.1s ease-in-out infinite; }
  @keyframes looseBall { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
  .piece.dim { opacity: .5; }
  .piece .marker { transition: transform .1s; }
  .piece.wary .marker { animation: wary .16s linear infinite; }
  @keyframes wary { 0%,100% { transform: translate(0,0) }
    25% { transform: translate(.7px,-.5px) } 50% { transform: translate(-.6px,.5px) }
    75% { transform: translate(.5px,.6px) } }
  .piece.robbed .marker { animation: robbed .28s linear 3; }
  @keyframes robbed { 0%,100% { transform: translate(0,0) }
    30% { transform: translate(-2px,0) } 70% { transform: translate(2px,0) } }
  .ball { pointer-events: none; transition: transform ${STEP_MS}ms linear; }
  .hud { margin-top: .5rem; font-size: .8rem; color: #666; }
  .hud-row { display: flex; align-items: center; justify-content: space-between;
    gap: .75rem; }
  .hud .status.stolen { color: ${COLOR.danger}; font-weight: 700; }
  .hud .status.won { color: #1560c4; font-weight: 700; }
  .hud-btns { display: flex; gap: .4rem; flex: none; }
  .reset, .stay { font: inherit; padding: .1rem .55rem; cursor: pointer; }
  .log { margin: .45rem 0 0; padding: .35rem .5rem; border-radius: 5px;
    background: #f1f1f1; color: #444; font-size: .78rem; line-height: 1.4; }
  .log.win { background: #e6effb; color: #14458c; }
  .log.steal { background: #fbe6e6; color: #a11; }`;

/**
 * The live layer, once per page. `initCase(section, DATA)` mirrors
 * `src/move-action/move-action.ts` — the same `MoveActionState`, the same
 * `idle → aiming → moving → (stopped | spent)` reducer over the same events,
 * including the ball-steal check: a carrier stepping into an opponent's
 * influence rolls a `d6` per opponent (seeded `mulberry32`, matching
 * `src/dice`), and a `1` ends the move and hands over the ball.
 *
 * It also mirrors the **tackle**: a selected defender that can reach the enemy
 * carrier's hex clicks it to lunge (`tackling`), spends all its move points, and
 * a `d6 + tackling` vs `d6 + dribbling` challenge (`resolveChallenge`) decides
 * the ball. A defender `1` is a foul (dead end, TODO); equal scores a loose
 * ball — `looseBall` scatters it (d6 direction, d6 distance) from the carrier's
 * hex and the first player on the line catches it. The winner's controller then
 * clicks a green hex to `relocate` the carrying piece, or `stay` for the
 * fallback spot.
 *
 * Kept honest by the playground test's cross-check against the real modules. No
 * backticks / `${` so it embeds verbatim.
 */
const SCRIPT = [
  "var DIRS = [[1,-1,0],[1,0,-1],[0,1,-1],[-1,1,0],[-1,0,1],[0,-1,1]];",
  "var STEP_MS = " + STEP_MS + ";",
  "var ARROW = '" + COLOR.arrow + "';",
  "var DANGER = '" + COLOR.danger + "';",
  "var SCATTER = '#6a5acd';",
  "function parse(k) { return k.split(',').map(Number); }",
  "function neighbours(key) {",
  "  var p = parse(key);",
  "  return DIRS.map(function (d) { return (p[0]+d[0])+','+(p[1]+d[1])+','+(p[2]+d[2]); });",
  "}",
  "function cubeDist(a, b) {",
  "  var p = parse(a), q = parse(b);",
  "  return (Math.abs(p[0]-q[0]) + Math.abs(p[1]-q[1]) + Math.abs(p[2]-q[2])) / 2;",
  "}",
  "// mulberry32, matching src/dice: [value, nextState]",
  "function nextRandom(s) {",
  "  var a = (s + 0x6d2b79f5) | 0;",
  "  var t = Math.imul(a ^ (a >>> 15), 1 | a);",
  "  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
  "  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];",
  "}",
  "function rollDie(s, sides) { var r = nextRandom(s); return [Math.floor(r[0]*sides)+1, r[1]]; }",
  "// generic d6+attr contest, mirrors resolveChallenge (attacker rolls first)",
  "function resolveChallenge(s, attA, defA, die) {",
  "  var a = rollDie(s, die), d = rollDie(a[1], die);",
  "  var as = a[0] + attA, ds = d[0] + defA, tie = as === ds;",
  "  return { attackerRoll: a[0], defenderRoll: d[0], attackerScore: as, defenderScore: ds,",
  "           tie: tie, winner: tie ? null : (as > ds ? 'attacker' : 'defender'), rng: d[1] };",
  "}",
  "// loose-ball scatter, mirrors src/loose-ball: d6 direction, d6 distance, first stopper wins",
  "function looseBall(s, origin, stoppers, die) {",
  "  var a = rollDie(s, 6), d = rollDie(a[1], die || 6);",
  "  var dir = DIRS[a[0] - 1];",
  "  var op = parse(origin);",
  "  var at = {};",
  "  stoppers.forEach(function (st) { at[st.at] = st.id; });",
  "  var route = [origin], caughtBy = null;",
  "  for (var step = 1; step <= d[0]; step++) {",
  "    var hex = (op[0] + dir[0]*step) + ',' + (op[1] + dir[1]*step) + ',' + (op[2] + dir[2]*step);",
  "    route.push(hex);",
  "    if (at[hex] != null) { caughtBy = at[hex]; break; }",
  "  }",
  "  return { directionRoll: a[0], distanceRoll: d[0], direction: dir, route: route,",
  "           rest: route[route.length - 1], caughtBy: caughtBy, rng: d[1] };",
  "}",
  "",
  "function initCase(section, DATA) {",
  "  var SIZE = DATA.size;",
  "  var board = new Set(DATA.board);",
  "  var obstacles = new Set(DATA.obstacles);",
  "  var svg = section.querySelector('.board');",
  "  var arrowLayer = svg.querySelector('.arrow-layer');",
  "  var ballEl = svg.querySelector('.ball');",
  "  var statusEl = section.querySelector('.status');",
  "  var logEl = section.querySelector('.log');",
  "  var stayBtn = section.querySelector('.stay');",
  "  var hexEls = new Map();",
  "  svg.querySelectorAll('.hex').forEach(function (el) { hexEls.set(el.dataset.key, el); });",
  "  var pieceEls = new Map();",
  "  svg.querySelectorAll('.piece').forEach(function (el) { pieceEls.set(el.dataset.id, el); });",
  "",
  "  function toPixel(key) {",
  "    var p = parse(key);",
  "    return { x: SIZE * Math.sqrt(3) * (p[0] + p[2] / 2), y: SIZE * 1.5 * p[2] };",
  "  }",
  "",
  "  // --- game state (mirrors MoveActionState) ---",
  "  var pieces = DATA.pieces.map(function (p) {",
  "    return { id: p.id, at: p.at, label: p.label, movePoints: p.movePoints,",
  "             team: p.team, attrs: p.attrs || {}, home: p.at, homeMP: p.movePoints };",
  "  });",
  "  var ball = DATA.ball;",
  "  var rng = DATA.seed | 0;",
  "  // the last resolved contest (steal or tackle), shown in the .log line until reset",
  "  var lastChallenge = null;",
  "  // set while the ball animates along a scatter route (loose ball)",
  "  var ballRollKey = null;",
  "  function piece(id) { return pieces.filter(function (p) { return p.id === id; })[0]; }",
  "  function ballCarrier() { return ball ? pieces.filter(function (p) { return p.at === ball; })[0] || null : null; }",
  "  function attrOf(p, key) {",
  "    return (p.attrs && p.attrs[key] != null) ? p.attrs[key] : (DATA.defaultAttr != null ? DATA.defaultAttr : 3);",
  "  }",
  "  function influencers(hex, team) {",
  "    return pieces.filter(function (p) { return p.team !== team && cubeDist(p.at, hex) === 1; })",
  "      .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });",
  "  }",
  "  // opponents whose influence `to` enters that `from` was not already in",
  "  function enteredInfluence(from, to, team) {",
  "    var before = new Set(influencers(from, team).map(function (p) { return p.id; }));",
  "    return influencers(to, team).filter(function (p) { return !before.has(p.id); });",
  "  }",
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
  "  function freeNeighbours(hex) {",
  "    var occ = new Set(obstacles);",
  "    pieces.forEach(function (p) { occ.add(p.at); });",
  "    return neighbours(hex).filter(function (k) { return !occ.has(k) && board.has(k); });",
  "  }",
  "  // mirrors reachTackle: route onto the carrier hex, carrier allowed last only",
  "  function reachTackle(defId) {",
  "    var def = piece(defId), carrier = ballCarrier();",
  "    if (!carrier || carrier.team === def.team) return null;",
  "    var blocked = blockersFor(defId); blocked.delete(carrier.at);",
  "    var dist = new Map([[def.at, 0]]), cameFrom = new Map(), frontier = [def.at];",
  "    for (var d = 0; d < def.movePoints && frontier.length; d++) {",
  "      var next = [];",
  "      for (var i = 0; i < frontier.length; i++) {",
  "        var ns = neighbours(frontier[i]);",
  "        for (var j = 0; j < ns.length; j++) {",
  "          var nk = ns[j];",
  "          if (dist.has(nk) || blocked.has(nk) || !board.has(nk)) continue;",
  "          dist.set(nk, d + 1); cameFrom.set(nk, frontier[i]);",
  "          if (nk !== carrier.at) next.push(nk);",
  "        }",
  "      }",
  "      frontier = next;",
  "    }",
  "    if (!dist.has(carrier.at)) return null;",
  "    var path = [carrier.at], step = carrier.at;",
  "    while (cameFrom.has(step)) { step = cameFrom.get(step); path.unshift(step); }",
  "    if (path.length - 1 > def.movePoints) return null;",
  "    return { path: path, start: path[0], approachEnd: path[path.length - 2], carrierId: carrier.id };",
  "  }",
  "  function relocationOptions(o) {",
  "    if (!o || o.winner === null) return [];",
  "    if (o.winner === 'defender') { var att = piece(o.attackerId); return att ? freeNeighbours(att.at) : []; }",
  "    return freeNeighbours(o.approachEnd);",
  "  }",
  "  function applyTackle(o, dest) {",
  "    if (o.winner === null) return;",
  "    var winnerId = o.winner === 'defender' ? o.defenderId : o.attackerId;",
  "    var fallback = o.winner === 'defender' ? o.start : o.at;",
  "    var target = dest || fallback;",
  "    piece(winnerId).at = target; ball = target;",
  "  }",
  "",
  "  // --- snapshot (mirrors MoveActionSnapshot) ---",
  "  function idle() { return { phase: 'idle', activeId: null, target: null, path: [], stepIndex: 0, steal: null, outcome: null }; }",
  "  var snap = idle();",
  "  var tree = null;",
  "  function aimingPhase(p) { return p.movePoints > 0 ? 'aiming' : 'spent'; }",
  "",
  "  function resolveTackle() {",
  "    var def = piece(snap.activeId), carrier = ballCarrier();",
  "    var path = snap.path;",
  "    var approachEnd = path[path.length - 2], start = path[0], at = carrier.at;",
  "    var roll = resolveChallenge(rng, attrOf(carrier, 'dribbling'), attrOf(def, 'tackling'), DATA.stealDie);",
  "    rng = roll.rng;",
  "    var foul = roll.defenderRoll === 1;",
  "    def.at = approachEnd; def.movePoints = 0;",
  "    var outcome = { defenderId: def.id, attackerId: carrier.id, at: at, start: start,",
  "                    approachEnd: approachEnd, roll: roll, foul: foul,",
  "                    winner: foul ? null : roll.winner };",
  "    lastChallenge = { kind: 'tackle', roll: roll, foul: foul, winner: outcome.winner,",
  "      defLabel: def.label, attLabel: carrier.label,",
  "      defAttr: attrOf(def, 'tackling'), attAttr: attrOf(carrier, 'dribbling') };",
  "    var base = { activeId: def.id, target: null, path: [], stepIndex: 0, steal: null, outcome: outcome };",
  "    if (foul) { snap = Object.assign({ phase: 'foul' }, base); return; }",
  "    if (roll.tie) {",
  "      var stoppers = pieces.map(function (p) { return { id: p.id, at: p.at }; });",
  "      var scatter = looseBall(rng, at, stoppers, DATA.stealDie);",
  "      rng = scatter.rng;",
  "      ball = scatter.rest;",
  "      lastChallenge.scatter = scatter;",
  "      snap = Object.assign({ phase: 'looseBall', scatter: scatter }, base);",
  "      return;",
  "    }",
  "    ball = roll.winner === 'defender' ? approachEnd : at;",
  "    snap = Object.assign({ phase: 'relocating' }, base);",
  "  }",
  "",
  "  function dispatch(ev) {",
  "    if (ev.type === 'selectPiece') {",
  "      if (snap.phase === 'moving' || snap.phase === 'tackling' || snap.phase === 'relocating') return;",
  "      var p = piece(ev.pieceId); if (!p) return;",
  "      snap = { phase: aimingPhase(p), activeId: p.id, target: null, path: [], stepIndex: 0, steal: null, outcome: null };",
  "      tree = flood(p.id);",
  "      lastChallenge = null;",
  "      ballRollKey = null;",
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
  "      snap.phase = 'moving'; snap.target = hex; snap.path = route; snap.stepIndex = 0; snap.steal = null;",
  "      lastChallenge = null;",
  "    } else if (ev.type === 'tackle') {",
  "      if (snap.phase !== 'aiming' || !snap.activeId) return;",
  "      var reach = reachTackle(snap.activeId); var c = ballCarrier();",
  "      if (!reach || !c) return;",
  "      snap = { phase: 'tackling', activeId: snap.activeId, target: c.at, path: reach.path,",
  "               stepIndex: 0, steal: null, outcome: null };",
  "      lastChallenge = null;",
  "    } else if (ev.type === 'relocate') {",
  "      if (snap.phase !== 'relocating' || !snap.outcome) return;",
  "      if (relocationOptions(snap.outcome).indexOf(ev.hex) < 0) return;",
  "      applyTackle(snap.outcome, ev.hex);",
  "      snap = { phase: 'spent', activeId: snap.outcome.defenderId, target: null, path: [], stepIndex: 0, steal: null, outcome: null };",
  "      tree = null;",
  "    } else if (ev.type === 'advance') {",
  "      if (snap.phase === 'tackling') {",
  "        var ti = snap.stepIndex + 1;",
  "        if (!snap.path[ti]) return;",
  "        if (ti < snap.path.length - 1) { snap.stepIndex = ti; return; }",
  "        resolveTackle();",
  "        return;",
  "      }",
  "      if (snap.phase !== 'moving') return;",
  "      var i = snap.stepIndex + 1;",
  "      var hex2 = snap.path[i];",
  "      var prev = snap.path[i - 1];",
  "      var mover = piece(snap.activeId);",
  "      var carrier = ballCarrier();",
  "      var carrying = carrier && carrier.id === snap.activeId;",
  "      if (carrying) {",
  "        var foes = enteredInfluence(prev, hex2, mover.team);",
  "        if (foes.length) {",
  "          var rolls = [], by = null;",
  "          for (var k = 0; k < foes.length; k++) {",
  "            var rr = rollDie(rng, DATA.stealDie); rng = rr[1]; rolls.push(rr[0]);",
  "            if (by === null && rr[0] <= DATA.stealOn) by = foes[k].id;",
  "          }",
  "          if (by !== null) {",
  "            mover.at = hex2; mover.movePoints -= i;",
  "            ball = piece(by).at;",
  "            lastChallenge = { kind: 'steal', ok: true, by: by, rolls: rolls, need: DATA.stealOn };",
  "            snap = { phase: 'stopped', activeId: snap.activeId, target: null, path: [], stepIndex: 0,",
  "                     steal: { by: by, at: hex2, rolls: rolls }, outcome: null };",
  "            return;",
  "          }",
  "          lastChallenge = { kind: 'steal', ok: false,",
  "            foes: foes.map(function (fp) { return fp.id; }), rolls: rolls, need: DATA.stealOn };",
  "        }",
  "      }",
  "      snap.stepIndex = i;",
  "      if (snap.stepIndex < snap.path.length - 1) return;",
  "      var ap = piece(snap.activeId);",
  "      var wasCarrier = carrying;",
  "      ap.at = snap.path[snap.path.length - 1];",
  "      ap.movePoints -= (snap.path.length - 1);",
  "      if (wasCarrier) ball = ap.at;",
  "      snap = { phase: aimingPhase(ap), activeId: ap.id, target: null, path: [], stepIndex: 0, steal: null, outcome: null };",
  "      tree = flood(ap.id);",
  "    } else if (ev.type === 'cancel') {",
  "      if (snap.phase === 'moving' || snap.phase === 'tackling') return;",
  "      if (snap.phase === 'relocating' && snap.outcome) {",
  "        applyTackle(snap.outcome, null);",
  "        snap = { phase: 'spent', activeId: snap.outcome.defenderId, target: null, path: [], stepIndex: 0, steal: null, outcome: null };",
  "        tree = null;",
  "        return;",
  "      }",
  "      snap = idle();",
  "      tree = null;",
  "    }",
  "  }",
  "",
  "  // --- rendering (mirrors moveView) ---",
  "  function svgEl(t) { return document.createElementNS('http://www.w3.org/2000/svg', t); }",
  "  function drawArrow(path, color) {",
  "    arrowLayer.replaceChildren();",
  "    if (path.length < 2) return;",
  "    var col = color || ARROW;",
  "    var pts = path.map(toPixel);",
  "    var poly = svgEl('polyline');",
  "    poly.setAttribute('points', pts.map(function (q) { return q.x.toFixed(2)+','+q.y.toFixed(2); }).join(' '));",
  "    poly.setAttribute('fill', 'none');",
  "    poly.setAttribute('stroke', col);",
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
  "    head.setAttribute('fill', col);",
  "    arrowLayer.appendChild(head);",
  "  }",
  "  function placeAt(el, key, dx, dy) {",
  "    var q = toPixel(key);",
  "    el.setAttribute('transform', 'translate(' + (q.x + (dx||0)).toFixed(2) + ' ' + (q.y + (dy||0)).toFixed(2) + ')');",
  "  }",
  "",
  "  // The persistent readout under the board: dice numbers + a plain-text result.",
  "  function challengeLog() {",
  "    var c = lastChallenge;",
  "    if (!c) return null;",
  "    if (c.kind === 'steal') {",
  "      var dice = 'd6 ' + c.rolls.join(', ') + ' (steal on \\u2264' + c.need + ')';",
  "      if (c.ok) {",
  "        return { cls: 'steal', text: 'successful ball-steal \\u2014 ' + piece(c.by).label +",
  "          ' takes the ball  \\u00b7  ' + dice };",
  "      }",
  "      var names = c.foes.map(function (id) { return piece(id).label; }).join(', ');",
  "      return { cls: '', text: 'failed ball-steal \\u2014 carrier breaks past ' + names +",
  "        '  \\u00b7  ' + dice };",
  "    }",
  "    var r = c.roll;",
  "    var dice2 = 'd6 ' + r.defenderRoll + '+' + c.defAttr + ' tackling  vs  d6 ' + r.attackerRoll + '+' +",
  "      c.attAttr + ' dribbling  \\u2192  ' + r.defenderScore + '\\u2013' + r.attackerScore;",
  "    if (c.foul) return { cls: 'steal', text: 'foul \\u2014 defender rolled 1  \\u00b7  ' + dice2 + '  (TODO)' };",
  "    if (c.winner === null) {",
  "      var s = c.scatter, tail = '';",
  "      if (s) {",
  "        var hexes = s.route.length - 1;",
  "        tail = '  \\u00b7  scatter d6 dir ' + s.directionRoll + ', d6 dist ' + s.distanceRoll + '  \\u2192  ' +",
  "          (s.caughtBy ? piece(s.caughtBy).label + ' collects it after ' + hexes + ' hex' + (hexes === 1 ? '' : 'es')",
  "                      : 'rolls ' + hexes + ' hex' + (hexes === 1 ? '' : 'es') + ' clear');",
  "      }",
  "      return { cls: '', text: 'loose ball \\u2014 scores level  \\u00b7  ' + dice2 + tail };",
  "    }",
  "    if (c.winner === 'defender') {",
  "      return { cls: 'win', text: 'successful tackle \\u2014 ' + c.defLabel + ' wins the ball  \\u00b7  ' + dice2 };",
  "    }",
  "    return { cls: '', text: 'failed tackle \\u2014 ' + c.attLabel + ' rides the challenge  \\u00b7  ' + dice2 };",
  "  }",
  "",
  "  function render() {",
  "    var carrier = ballCarrier();",
  "    var carrying = carrier && snap.activeId != null && carrier.id === snap.activeId;",
  "    var tk = (snap.phase === 'aiming' && snap.activeId) ? reachTackle(snap.activeId) : null;",
  "    var relo = (snap.phase === 'relocating' && snap.outcome) ? relocationOptions(snap.outcome) : [];",
  "    var reloSet = new Set(relo);",
  "    // hazards on the previewed path (aiming, carrier only)",
  "    var hazards = new Set();",
  "    if (snap.phase === 'aiming' && carrying) {",
  "      var active = piece(snap.activeId);",
  "      for (var i = 1; i < snap.path.length; i++) {",
  "        if (enteredInfluence(snap.path[i-1], snap.path[i], active.team).length) hazards.add(snap.path[i]);",
  "      }",
  "    }",
  "    pieces.forEach(function (p) {",
  "      var el = pieceEls.get(p.id);",
  "      var walking = (snap.phase === 'moving' || snap.phase === 'tackling') && p.id === snap.activeId;",
  "      placeAt(el, walking ? snap.path[snap.stepIndex] : p.at);",
  "      el.classList.toggle('selected', p.id === snap.activeId);",
  "      el.classList.toggle('dim', p.movePoints === 0 && p.id !== snap.activeId && !(snap.outcome && snap.outcome.winner === 'attacker' && p.id === snap.outcome.attackerId));",
  "      el.classList.toggle('wary', (p.id === snap.activeId && hazards.size > 0) || (tk && p.id === tk.carrierId));",
  "      el.classList.toggle('robbed', (snap.steal != null && p.id === snap.activeId) || (snap.phase === 'foul' && snap.outcome && p.id === snap.outcome.defenderId));",
  "      el.classList.toggle('tackle-target', tk != null && p.id === tk.carrierId);",
  "      el.classList.toggle('caught', snap.phase === 'looseBall' && snap.scatter != null && snap.scatter.caughtBy === p.id && !ballRollKey);",
  "    });",
  "    if (ballEl) {",
  "      var bkey = ball;",
  "      if (snap.phase === 'moving' && carrier && carrier.id === snap.activeId) bkey = snap.path[snap.stepIndex];",
  "      if (ballRollKey) bkey = ballRollKey;",
  "      var loose = snap.phase === 'looseBall' && (!snap.scatter || !snap.scatter.caughtBy);",
  "      ballEl.classList.toggle('loose', !!loose && !ballRollKey);",
  "      if (bkey) placeAt(ballEl, bkey, SIZE * 0.4, -SIZE * 0.4);",
  "    }",
  "    var reach = new Set();",
  "    if (tree && (snap.phase === 'aiming' || snap.phase === 'spent')) {",
  "      tree.dist.forEach(function (d, key) { if (key !== tree.origin) reach.add(key); });",
  "    }",
  "    hexEls.forEach(function (el, key) {",
  "      el.classList.toggle('reach', reach.has(key) && !reloSet.has(key));",
  "      el.classList.toggle('hazard', hazards.has(key));",
  "      el.classList.toggle('relo', reloSet.has(key));",
  "    });",
  "    if (snap.phase === 'tackling') drawArrow(snap.path, DANGER);",
  "    else if (snap.phase === 'looseBall' && snap.scatter) drawArrow(snap.scatter.route, SCATTER);",
  "    else if (tk && snap.path.length < 2) drawArrow(tk.path, DANGER);",
  "    else drawArrow(snap.path, hazards.size > 0 ? DANGER : ARROW);",
  "    statusEl.classList.toggle('stolen', snap.phase === 'stopped' || snap.phase === 'foul' || snap.phase === 'looseBall');",
  "    statusEl.classList.toggle('won', snap.phase === 'relocating');",
  "    stayBtn.hidden = snap.phase !== 'relocating';",
  "    if (snap.steal) {",
  "      var thief = piece(snap.steal.by);",
  "      statusEl.textContent = 'successful ball-steal \\u2014 ball to ' + thief.label;",
  "    } else if (snap.phase === 'foul') {",
  "      statusEl.textContent = 'foul \\u2014 defender rolled 1 (TODO)';",
  "    } else if (snap.phase === 'looseBall') {",
  "      var sc = snap.scatter;",
  "      statusEl.textContent = !sc ? 'loose ball \\u2014 scores level'",
  "        : sc.caughtBy ? 'loose ball \\u2014 ' + piece(sc.caughtBy).label + ' pounces on it'",
  "        : 'loose ball \\u2014 it rolls ' + (sc.route.length - 1) + ' hex' + (sc.route.length - 1 === 1 ? '' : 'es') + ' free';",
  "    } else if (snap.phase === 'relocating') {",
  "      var o = snap.outcome, w = o.winner === 'defender' ? piece(o.defenderId) : piece(o.attackerId);",
  "      var head = o.winner === 'defender' ? 'successful tackle' : 'failed tackle';",
  "      statusEl.textContent = head + ' \\u2014 place ' + w.label + ' in ' + relo.length + ' hex' +",
  "        (relo.length === 1 ? '' : 'es') + ' \\u2014 or stay';",
  "    } else if (snap.phase === 'tackling') statusEl.textContent = 'tackling\\u2026';",
  "    else if (snap.phase === 'idle') statusEl.textContent = 'select a piece';",
  "    else if (snap.phase === 'moving') statusEl.textContent = 'moving\\u2026';",
  "    else {",
  "      var ap = piece(snap.activeId);",
  "      var note = carrying && hazards.size ? '  \\u26a0 ' + hazards.size + ' risky' : (tk ? '  \\u2014 click ' + piece(tk.carrierId).label + ' to tackle' : '');",
  "      statusEl.textContent = ap.label + ': ' + ap.movePoints + ' MP  \\u00b7  ' + reach.size + ' in reach' + note;",
  "    }",
  "    var log = challengeLog();",
  "    logEl.hidden = !log;",
  "    logEl.className = 'log' + (log && log.cls ? ' ' + log.cls : '');",
  "    logEl.textContent = log ? log.text : '';",
  "  }",
  "",
  "  // Roll the loose ball along its scatter route, one hex at a time.",
  "  function rollBall() {",
  "    var route = snap.scatter.route, i = 0;",
  "    (function hop() {",
  "      ballRollKey = route[i]; i++;",
  "      render();",
  "      if (i < route.length) setTimeout(hop, STEP_MS);",
  "      else setTimeout(function () { ballRollKey = null; render(); }, STEP_MS);",
  "    })();",
  "  }",
  "  // Walk a committed path (moving or the tackle approach) hex by hex.",
  "  function runWalk() {",
  "    (function stepOn() {",
  "      if (snap.phase !== 'moving' && snap.phase !== 'tackling') {",
  "        render();",
  "        if (snap.phase === 'looseBall' && snap.scatter) rollBall();",
  "        return;",
  "      }",
  "      dispatch({ type: 'advance' });",
  "      render();",
  "      if (snap.phase === 'moving' || snap.phase === 'tackling') setTimeout(stepOn, STEP_MS);",
  "      else if (snap.phase === 'looseBall' && snap.scatter) rollBall();",
  "    })();",
  "  }",
  "",
  "  hexEls.forEach(function (el, key) {",
  "    el.addEventListener('pointerenter', function () { dispatch({ type: 'hoverHex', hex: key }); render(); });",
  "    el.addEventListener('pointerleave', function () { dispatch({ type: 'hoverHex', hex: null }); render(); });",
  "    el.addEventListener('click', function () {",
  "      if (snap.phase === 'relocating') { dispatch({ type: 'relocate', hex: key }); render(); return; }",
  "      if (snap.phase !== 'aiming') return;",
  "      dispatch({ type: 'commit', hex: key });",
  "      if (snap.phase === 'moving') runWalk(); else render();",
  "    });",
  "  });",
  "  pieceEls.forEach(function (el, id) {",
  "    el.addEventListener('click', function (e) {",
  "      e.stopPropagation();",
  "      if (snap.phase === 'aiming' && snap.activeId) {",
  "        var reach = reachTackle(snap.activeId), c = ballCarrier();",
  "        if (reach && c && c.id === id) {",
  "          dispatch({ type: 'tackle' }); render();",
  "          if (snap.phase === 'tackling') runWalk();",
  "          return;",
  "        }",
  "      }",
  "      dispatch({ type: 'selectPiece', pieceId: id });",
  "      render();",
  "    });",
  "  });",
  "  stayBtn.addEventListener('click', function () { dispatch({ type: 'cancel' }); render(); });",
  "  section.querySelector('.reset').addEventListener('click', function () {",
  "    if (snap.phase === 'moving' || snap.phase === 'tackling') return;",
  "    pieces.forEach(function (p) { p.at = p.home; p.movePoints = p.homeMP; });",
  "    ball = DATA.ball;",
  "    rng = (Math.random() * 0x7fffffff) | 0;",
  "    snap = idle();",
  "    tree = null;",
  "    lastChallenge = null;",
  "    ballRollKey = null;",
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
    `pick it up — reachable hexes turn blue. Hover one for the move arrow, click ` +
    `to walk there hex by hex. If the ball carrier steps beside an opponent ` +
    `(red pulsing hexes) a d6 is rolled per opponent — a <strong>1</strong> and ` +
    `they take the ball and the move ends. A selected defender that can reach the ` +
    `enemy carrier (glowing red) clicks it to <strong>tackle</strong>: it spends ` +
    `all its move points and a d6 + tackling vs d6 + dribbling challenge decides ` +
    `the ball. The winner clicks a green hex to reposition, or <strong>stay</strong>. ` +
    `A defender 1 is a foul (still TODO); level scores <strong>spill the ball</strong> — ` +
    `a d6 direction and a d6 distance roll it in a straight line (slate arrow) until a ` +
    `player on the line pounces on it, else it sits loose where it stops. ` +
    `Every challenge logs its dice and a plain result under the board — ` +
    `<em>successful ball-steal</em>, <em>failed tackle</em>, <em>successful tackle</em>. ` +
    `<strong>reset</strong> re-rolls the seed. Same reducer as <code>move-action</code>.</p>\n` +
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
