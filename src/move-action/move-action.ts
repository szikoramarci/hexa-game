import { cubeEquals, type Cube } from "../coordinates/coordinates.js";
import type { ArrowStyle } from "../arrow/arrow.js";
import { cubeDistance } from "../distance/distance.js";
import { rollDie, seedRng, type Rng } from "../dice/dice.js";
import { reachableCubes } from "../movement/movement.js";
import { pathCubes } from "../pathfind/pathfind.js";

/**
 * The movement action — the process that turns "pick a piece, aim, walk it
 * there" into pure data. It composes the existing lego (`reachableCubes`,
 * `pathCubes`, `hexArrow`, `movePiece`, `dice`) and touches no DOM, no timers,
 * no rendering.
 *
 * Use it either way:
 * - **direct** — {@link reachableForPiece}, {@link movePath}, {@link moveArrow},
 *   {@link pathHazards}, {@link applyMove}, called in whatever order your UI needs;
 * - **event reducer** — {@link initMoveAction} / {@link moveAction} /
 *   {@link moveView}, fed UI events and walked through
 *   `idle -> aiming -> moving -> spent` (or `stopped`, when the ball is stolen).
 *
 * **Ball steal.** While the moving piece carries the ball (it stands on
 * `state.ball`), every step is checked: a `d6` is rolled for each opponent whose
 * *influence* — the six hexes around it — the carrier **steps into** on that
 * hex, i.e. covers the hex just entered but not the one just left. Walking
 * forward while staying inside the same opponent's influence does **not** roll
 * again; leaving and re-entering does. A roll at or below `stealOn` (default
 * `1`) hands that opponent the ball and ends the move where it stands. Rolls
 * come from a seeded PRNG carried in the snapshot, so the whole thing replays.
 */

/** A piece on the board that this action can move. */
export interface Piece {
  id: string;
  /** Drawn on the piece — a name or a number. */
  label: string | number;
  at: Cube;
  /** Hexes it may travel this action. A non-negative integer. */
  movePoints: number;
  /** Which side the piece is on. Exactly two teams are in play. */
  team: string;
}

/** The slice of game state the movement action reads and writes. */
export interface MoveActionState {
  pieces: readonly Piece[];
  /** Static blocking hexes — walls, terrain. */
  obstacles: readonly Cube[];
  /** Whether other pieces block movement too. Defaults to `true`. */
  piecesBlock?: boolean;
  /** The hex the ball sits on. Its carrier is the piece standing there. */
  ball?: Cube;
  /** Die size for a steal check. Default `6`. */
  stealDie?: number;
  /** A steal-check roll at or below this takes the ball. Default `1`. */
  stealOn?: number;
}

/** An {@link ArrowStyle} plus the hexes to draw it through — feeds `hexArrow`. */
export interface MoveArrow extends ArrowStyle {
  hexes: Cube[];
}

/** What happened when an opponent took the ball mid-move. */
export interface StealOutcome {
  /** Id of the opponent who took the ball. */
  by: string;
  /** The hex the moving piece was on when it happened. */
  at: Cube;
  /** Every steal-check roll made on that hex, in opponent-id order. */
  rolls: number[];
}

const copy = (c: Cube): Cube => ({ x: c.x, y: c.y, z: c.z });
const byId = (a: Piece, b: Piece): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function requirePiece(state: MoveActionState, pieceId: string): Piece {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) throw new RangeError(`no piece with id ${JSON.stringify(pieceId)}`);
  return piece;
}

/** The piece carrying the ball — the one standing on `state.ball` — or `null`. */
export function ballCarrier(state: MoveActionState): Piece | null {
  const ball = state.ball;
  if (!ball) return null;
  return state.pieces.find((p) => cubeEquals(p.at, ball)) ?? null;
}

/**
 * Opponents of `team` whose *influence* — their six surrounding hexes — covers
 * `hex`. Sorted by id, so a tie between two thieves resolves the same way every
 * time.
 */
export function influencers(
  state: MoveActionState,
  hex: Cube,
  team: string,
): Piece[] {
  return state.pieces
    .filter((p) => p.team !== team && cubeDistance(p.at, hex) === 1)
    .sort(byId);
}

/**
 * Every hex `pieceId` sees as blocked: the static obstacles plus, unless
 * `piecesBlock` is `false`, every *other* piece's hex. The piece's own hex is
 * never blocked — it is leaving it.
 */
export function blockersFor(state: MoveActionState, pieceId: string): Cube[] {
  const blockers = state.obstacles.map(copy);
  if (state.piecesBlock !== false) {
    for (const p of state.pieces) {
      if (p.id !== pieceId) blockers.push(copy(p.at));
    }
  }
  return blockers;
}

/**
 * The hexes `pieceId` can reach this action — `reachableCubes` from its hex
 * within its `movePoints`, around {@link blockersFor}, with its own hex removed.
 */
export function reachableForPiece(
  state: MoveActionState,
  pieceId: string,
): Cube[] {
  const piece = requirePiece(state, pieceId);
  return reachableCubes(piece.at, piece.movePoints, blockersFor(state, pieceId))
    .filter((h) => !cubeEquals(h, piece.at));
}

/**
 * The shortest path `pieceId` would walk to `target` — `pathCubes` around
 * {@link blockersFor}, both endpoints included — or `null` when `target` is
 * unreachable or further than `movePoints` steps.
 */
export function movePath(
  state: MoveActionState,
  pieceId: string,
  target: Cube,
): Cube[] | null {
  const piece = requirePiece(state, pieceId);
  const path = pathCubes(piece.at, target, blockersFor(state, pieceId));
  if (!path || path.length - 1 > piece.movePoints) return null;
  return path;
}

/**
 * Opponents whose influence the mover **steps into** moving `from` -> `to`:
 * those covering `to` but not `from`. These are the ones a steal check rolls
 * for. Sorted by id.
 */
export function enteredInfluence(
  state: MoveActionState,
  from: Cube,
  to: Cube,
  team: string,
): Piece[] {
  const before = new Set(influencers(state, from, team).map((p) => p.id));
  return influencers(state, to, team).filter((p) => !before.has(p.id));
}

/**
 * The steps of `path` where the carrier crosses into a *new* opponent's
 * influence — the hexes where a steal check fires. Empty unless `pieceId` is the
 * ball carrier: only the carrier is at risk. Staying inside an influence you
 * were already in is not a hazard step.
 */
export function pathHazards(
  state: MoveActionState,
  pieceId: string,
  path: readonly Cube[],
): Cube[] {
  const carrier = ballCarrier(state);
  if (!carrier || carrier.id !== pieceId) return [];
  const out: Cube[] = [];
  for (let i = 1; i < path.length; i++) {
    if (enteredInfluence(state, path[i - 1]!, path[i]!, carrier.team).length > 0) {
      out.push(copy(path[i]!));
    }
  }
  return out;
}

/**
 * A dashed straight {@link MoveArrow} through `path` — drop into
 * `hexArrow(a.hexes, a)` or a `Scenario.arrows` entry. `null` for a path with
 * fewer than two hexes. `style` overrides the dashed-orange default.
 */
export function moveArrow(
  path: readonly Cube[],
  style?: ArrowStyle,
): MoveArrow | null {
  if (path.length < 2) return null;
  return {
    shape: "straight",
    dash: "dashed",
    color: "#ff8c00",
    ...style,
    hexes: path.map(copy),
  };
}

/**
 * Commit a move: `pieceId` ends on `path`'s last hex and loses `path.length - 1`
 * move points. If it was the ball carrier the ball rides along to the same hex.
 * Every other piece is untouched. Returns a fresh state.
 */
export function applyMove(
  state: MoveActionState,
  pieceId: string,
  path: readonly Cube[],
): MoveActionState {
  const piece = requirePiece(state, pieceId);
  const dest = path[path.length - 1];
  if (!dest) return state;
  const spent = path.length - 1;
  const carriesBall = state.ball != null && cubeEquals(piece.at, state.ball);
  return {
    ...state,
    ...(carriesBall ? { ball: copy(dest) } : {}),
    pieces: state.pieces.map((p) =>
      p.id === pieceId
        ? { ...p, at: copy(dest), movePoints: p.movePoints - spent }
        : p,
    ),
  };
}

// --- event reducer --------------------------------------------------------

/**
 * Where the action is in the flow. `stopped` is a dead end reached only when the
 * ball is stolen mid-move — select another piece or `cancel` to leave it.
 */
export type MovePhase = "idle" | "aiming" | "moving" | "stopped" | "spent";

export type MoveActionEvent =
  | { type: "selectPiece"; pieceId: string }
  | { type: "hoverHex"; hex: Cube | null }
  | { type: "commit"; hex?: Cube }
  | { type: "advance" }
  | { type: "cancel" };

/** The full, serialisable state of one movement action in progress. */
export interface MoveActionSnapshot {
  state: MoveActionState;
  phase: MovePhase;
  activeId: string | null;
  target: Cube | null;
  /** To `target` while aiming; the committed route while moving. */
  path: Cube[];
  /** Hexes walked so far while moving. */
  stepIndex: number;
  /** Seeded PRNG state — advances by one draw per steal-check roll. */
  rng: Rng;
  /** Set for one snapshot the moment a steal ends the move (phase `stopped`). */
  steal: StealOutcome | null;
}

/** One hex segment of a walk, plus who a steal check will roll for. */
export interface MoveStep {
  from: Cube;
  to: Cube;
  index: number;
  count: number;
  /** Ids of opponents whose influence the carrier *enters* at `to` — one roll each. */
  contest: string[];
}

/** A flat frame for the renderer — everything it needs, nothing it doesn't. */
export interface MoveActionView {
  phase: MovePhase;
  active: Piece | null;
  pieces: readonly Piece[];
  /** The hex the ball is on, or `null`. */
  ball: Cube | null;
  /** Does the active piece carry the ball? */
  carrying: boolean;
  /** Empty unless aiming (or spent — an empty region). */
  reachable: Cube[];
  target: Cube | null;
  path: Cube[];
  arrow: MoveArrow | null;
  /**
   * Steps of the previewed path where the carrier crosses into a new opponent's
   * influence — the hexes a steal check will fire on. Mark these and make the
   * carrier look wary. Empty unless the active piece carries the ball.
   */
  hazards: Cube[];
  /** The hex step currently being animated — `moving` only. */
  step: MoveStep | null;
  /** Set the frame a steal ends the move; `null` otherwise. */
  steal: StealOutcome | null;
}

/** The interaction fields reset to their `idle` values (fresh `path` array). */
const idleFields = (): Pick<
  MoveActionSnapshot,
  "phase" | "activeId" | "target" | "path" | "stepIndex" | "steal"
> => ({
  phase: "idle",
  activeId: null,
  target: null,
  path: [],
  stepIndex: 0,
  steal: null,
});

/**
 * Start a movement action over `state`, in the `idle` phase. `seed` fixes the
 * dice: the same seed replays every steal check identically.
 */
export function initMoveAction(
  state: MoveActionState,
  seed: number | string = 1,
): MoveActionSnapshot {
  return { state, ...idleFields(), rng: seedRng(seed) };
}

const aimingPhase = (piece: Piece): MovePhase =>
  piece.movePoints > 0 ? "aiming" : "spent";

/** Roll the steal check for a carrier stepping `from` -> `hex`. */
function resolveSteal(
  state: MoveActionState,
  mover: Piece,
  from: Cube,
  hex: Cube,
  rng: Rng,
): { by: string | null; rolls: number[]; rng: Rng } {
  const foes = enteredInfluence(state, from, hex, mover.team);
  if (foes.length === 0) return { by: null, rolls: [], rng };

  const die = state.stealDie ?? 6;
  const on = state.stealOn ?? 1;
  const rolls: number[] = [];
  let by: string | null = null;
  let next = rng;
  for (const foe of foes) {
    const [roll, after] = rollDie(next, die);
    next = after;
    rolls.push(roll);
    if (by === null && roll <= on) by = foe.id;
  }
  return { by, rolls, rng: next };
}

/**
 * Apply one {@link MoveActionEvent}. Pure: `snap` is never mutated, and an event
 * that does not apply (wrong phase, unknown piece, unreachable hex) returns
 * `snap` unchanged.
 */
export function moveAction(
  snap: MoveActionSnapshot,
  event: MoveActionEvent,
): MoveActionSnapshot {
  switch (event.type) {
    case "selectPiece": {
      if (snap.phase === "moving") return snap;
      const piece = snap.state.pieces.find((p) => p.id === event.pieceId);
      if (!piece) return snap;
      return {
        state: snap.state,
        phase: aimingPhase(piece),
        activeId: piece.id,
        target: null,
        path: [],
        stepIndex: 0,
        rng: snap.rng,
        steal: null,
      };
    }

    case "hoverHex": {
      if (snap.phase !== "aiming" || !snap.activeId) return snap;
      if (!event.hex) {
        if (!snap.target) return snap;
        return { ...snap, target: null, path: [] };
      }
      const path = movePath(snap.state, snap.activeId, event.hex);
      if (!path) return { ...snap, target: null, path: [] };
      return { ...snap, target: copy(event.hex), path };
    }

    case "commit": {
      if (snap.phase !== "aiming" || !snap.activeId) return snap;
      const hex = event.hex ?? snap.target;
      if (!hex) return snap;
      const path = movePath(snap.state, snap.activeId, hex);
      if (!path || path.length < 2) return snap;
      return {
        ...snap,
        phase: "moving",
        target: copy(hex),
        path,
        stepIndex: 0,
        steal: null,
      };
    }

    case "advance": {
      if (snap.phase !== "moving" || !snap.activeId) return snap;
      const stepIndex = snap.stepIndex + 1;
      const hex = snap.path[stepIndex];
      const from = snap.path[stepIndex - 1];
      if (!hex || !from) return snap;

      const mover = requirePiece(snap.state, snap.activeId);
      const carrier = ballCarrier(snap.state);
      let rng = snap.rng;

      if (carrier && carrier.id === snap.activeId) {
        const check = resolveSteal(snap.state, mover, from, hex, rng);
        rng = check.rng;
        if (check.by !== null) {
          const walked = snap.path.slice(0, stepIndex + 1);
          const moved = applyMove(snap.state, snap.activeId, walked);
          const thief = requirePiece(moved, check.by);
          return {
            state: { ...moved, ball: copy(thief.at) },
            phase: "stopped",
            activeId: snap.activeId,
            target: null,
            path: [],
            stepIndex: 0,
            rng,
            steal: { by: check.by, at: copy(hex), rolls: check.rolls },
          };
        }
      }

      if (stepIndex < snap.path.length - 1) {
        return { ...snap, stepIndex, rng };
      }
      const state = applyMove(snap.state, snap.activeId, snap.path);
      const piece = requirePiece(state, snap.activeId);
      return {
        state,
        phase: aimingPhase(piece),
        activeId: piece.id,
        target: null,
        path: [],
        stepIndex: 0,
        rng,
        steal: null,
      };
    }

    case "cancel":
      return snap.phase === "moving"
        ? snap
        : { state: snap.state, ...idleFields(), rng: snap.rng };

    default:
      return snap;
  }
}

/** Derive the {@link MoveActionView} for the current snapshot. */
export function moveView(snap: MoveActionSnapshot): MoveActionView {
  const active =
    snap.activeId != null
      ? (snap.state.pieces.find((p) => p.id === snap.activeId) ?? null)
      : null;

  const carrier = ballCarrier(snap.state);
  const carrying = active != null && carrier?.id === active.id;

  const reachable =
    active && (snap.phase === "aiming" || snap.phase === "spent")
      ? reachableForPiece(snap.state, active.id)
      : [];

  const hazards =
    active && snap.phase === "aiming"
      ? pathHazards(snap.state, active.id, snap.path)
      : [];

  let step: MoveStep | null = null;
  if (
    snap.phase === "moving" &&
    active &&
    snap.stepIndex < snap.path.length - 1
  ) {
    const from = snap.path[snap.stepIndex]!;
    const to = snap.path[snap.stepIndex + 1]!;
    step = {
      from,
      to,
      index: snap.stepIndex,
      count: snap.path.length - 1,
      contest: carrying
        ? enteredInfluence(snap.state, from, to, active.team).map((p) => p.id)
        : [],
    };
  }

  return {
    phase: snap.phase,
    active,
    pieces: snap.state.pieces,
    ball: snap.state.ball ?? null,
    carrying,
    reachable,
    target: snap.target,
    path: snap.path,
    arrow: moveArrow(snap.path),
    hazards,
    step,
    steal: snap.steal,
  };
}
