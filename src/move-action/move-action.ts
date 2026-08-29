import { cubeEquals, type Cube } from "../coordinates/coordinates.js";
import type { ArrowStyle } from "../arrow/arrow.js";
import { reachableCubes } from "../movement/movement.js";
import { pathCubes } from "../pathfind/pathfind.js";

/**
 * The movement action — the process that turns "pick a piece, aim, walk it
 * there" into pure data. It composes the existing lego (`reachableCubes`,
 * `pathCubes`, `hexArrow`, `movePiece`) and touches no DOM, no timers, no
 * rendering.
 *
 * Use it either way:
 * - **direct** — {@link reachableForPiece}, {@link movePath}, {@link moveArrow},
 *   {@link applyMove}, called in whatever order your UI needs;
 * - **event reducer** — {@link initMoveAction} / {@link moveAction} /
 *   {@link moveView}, fed UI events and walked through
 *   `idle -> aiming -> moving -> spent`.
 */

/** A piece on the board that this action can move. */
export interface Piece {
  id: string;
  /** Drawn on the piece — a name or a number. */
  label: string | number;
  at: Cube;
  /** Hexes it may travel this action. A non-negative integer. */
  movePoints: number;
}

/** The slice of game state the movement action reads and writes. */
export interface MoveActionState {
  pieces: readonly Piece[];
  /** Static blocking hexes — walls, terrain. */
  obstacles: readonly Cube[];
  /** Whether other pieces block movement too. Defaults to `true`. */
  piecesBlock?: boolean;
}

/** An {@link ArrowStyle} plus the hexes to draw it through — feeds `hexArrow`. */
export interface MoveArrow extends ArrowStyle {
  hexes: Cube[];
}

const copy = (c: Cube): Cube => ({ x: c.x, y: c.y, z: c.z });

function requirePiece(state: MoveActionState, pieceId: string): Piece {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) throw new RangeError(`no piece with id ${JSON.stringify(pieceId)}`);
  return piece;
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
 * move points. Every other piece is untouched. Returns a fresh state.
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
  return {
    ...state,
    pieces: state.pieces.map((p) =>
      p.id === pieceId
        ? { ...p, at: copy(dest), movePoints: p.movePoints - spent }
        : p,
    ),
  };
}

// --- event reducer --------------------------------------------------------

/** Where the action is in the select -> aim -> walk flow. */
export type MovePhase = "idle" | "aiming" | "moving" | "spent";

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
}

/** A flat frame for the renderer — everything it needs, nothing it doesn't. */
export interface MoveActionView {
  phase: MovePhase;
  active: Piece | null;
  pieces: readonly Piece[];
  /** Empty unless aiming (or spent — an empty region). */
  reachable: Cube[];
  target: Cube | null;
  path: Cube[];
  arrow: MoveArrow | null;
  /** The hex step currently being animated — `moving` only. */
  step: { from: Cube; to: Cube; index: number; count: number } | null;
}

/** The interaction fields reset to their `idle` values (fresh `path` array). */
const idleFields = (): Omit<MoveActionSnapshot, "state"> => ({
  phase: "idle",
  activeId: null,
  target: null,
  path: [],
  stepIndex: 0,
});

/** Start a movement action over `state`, in the `idle` phase. */
export function initMoveAction(state: MoveActionState): MoveActionSnapshot {
  return { state, ...idleFields() };
}

const aimingPhase = (piece: Piece): MovePhase =>
  piece.movePoints > 0 ? "aiming" : "spent";

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
      return { ...snap, phase: "moving", target: copy(hex), path, stepIndex: 0 };
    }

    case "advance": {
      if (snap.phase !== "moving" || !snap.activeId) return snap;
      const stepIndex = snap.stepIndex + 1;
      if (stepIndex < snap.path.length - 1) return { ...snap, stepIndex };
      const state = applyMove(snap.state, snap.activeId, snap.path);
      const piece = requirePiece(state, snap.activeId);
      return {
        state,
        phase: aimingPhase(piece),
        activeId: piece.id,
        target: null,
        path: [],
        stepIndex: 0,
      };
    }

    case "cancel":
      return snap.phase === "moving"
        ? snap
        : { state: snap.state, ...idleFields() };

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

  const reachable =
    active && (snap.phase === "aiming" || snap.phase === "spent")
      ? reachableForPiece(snap.state, active.id)
      : [];

  const step =
    snap.phase === "moving" && snap.stepIndex < snap.path.length - 1
      ? {
          from: snap.path[snap.stepIndex]!,
          to: snap.path[snap.stepIndex + 1]!,
          index: snap.stepIndex,
          count: snap.path.length - 1,
        }
      : null;

  return {
    phase: snap.phase,
    active,
    pieces: snap.state.pieces,
    reachable,
    target: snap.target,
    path: snap.path,
    arrow: moveArrow(snap.path),
    step,
  };
}
