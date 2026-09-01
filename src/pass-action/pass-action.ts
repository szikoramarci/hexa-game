import { cubeEquals, cubeKey, type Cube } from "../coordinates/coordinates.js";
import type { ArrowStyle } from "../arrow/arrow.js";
import { rollDie, seedRng, type Rng } from "../dice/dice.js";
import { lineCoverageCubes } from "../line-coverage/line-coverage.js";
import { pixelRangeCubes } from "../pixel-range/pixel-range.js";
import {
  ballCarrier,
  influencers,
  type MoveActionState,
  type Piece,
} from "../move-action/move-action.js";

/**
 * The ground pass — the ball carrier kicks the ball to a hex inside a rounded
 * kick range. It composes the existing lego (`pixelRangeCubes` for the range,
 * `lineCoverageCubes` for the lane, `hexArrow` for the preview, `dice` for the
 * interception roll) and touches no DOM, no timers, no rendering. A sibling
 * **action** to `move-action`, sharing its `MoveActionState` / `Piece` and the
 * `ballCarrier` / `influencers` helpers.
 *
 * Use it either way:
 * - **direct** — {@link passTargets}, {@link passLane}, {@link passInterceptors},
 *   {@link passArrow}, {@link applyPass}, in whatever order the UI needs;
 * - **event reducer** — {@link initPassAction} / {@link passAction} /
 *   {@link passView}, walked through
 *   `idle -> aiming -> passing -> (received | loose | intercepted)`.
 *
 * **Shadow.** Opponents block the kick: a target hex is illegal when the
 * straight lane from the carrier covers an enemy's hex — every hex *behind* a
 * defender drops out of the range. Teammates never block. **Interception.** As
 * the ball rolls the lane, each opponent whose influence (its six neighbours)
 * covers a flight hex gets one `d6` the first time the ball comes adjacent; a
 * roll at or above `interceptOn` (default `6`) picks the pass off and the ball
 * stops on that opponent. Rolls come from a seeded PRNG in the snapshot, so a
 * whole game replays.
 */

const DEFAULT_PASS_RANGE = 4;
const DEFAULT_INTERCEPT_ON = 6;

const copy = (c: Cube): Cube => ({ x: c.x, y: c.y, z: c.z });
const byId = (a: Piece, b: Piece): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The piece named by `carrierId` — which must be the current {@link ballCarrier}.
 * Throws `RangeError` for an unknown id or a piece that is not holding the ball.
 */
function requireCarrier(state: MoveActionState, carrierId: string): Piece {
  const piece = state.pieces.find((p) => p.id === carrierId);
  if (!piece) {
    throw new RangeError(`no piece with id ${JSON.stringify(carrierId)}`);
  }
  const carrier = ballCarrier(state);
  if (!carrier || carrier.id !== carrierId) {
    throw new RangeError(
      `piece ${JSON.stringify(carrierId)} is not the ball carrier`,
    );
  }
  return piece;
}

/** Keys of every hex an opponent of `team` stands on. */
function enemyHexKeys(state: MoveActionState, team: string): Set<string> {
  return new Set(
    state.pieces.filter((p) => p.team !== team).map((p) => cubeKey(p.at)),
  );
}

/**
 * The rounded kick disc — `pixelRangeCubes(carrier.at, passRange)` with the
 * carrier's own hex removed. Shadows are *not* applied here; see
 * {@link passTargets}.
 */
export function passRangeCubes(
  state: MoveActionState,
  carrierId: string,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  const range = state.passRange ?? DEFAULT_PASS_RANGE;
  return pixelRangeCubes(carrier.at, range).filter(
    (h) => !cubeEquals(h, carrier.at),
  );
}

/**
 * The supercover hexes the ball crosses on its way to `target` —
 * `lineCoverageCubes(carrier.at, target)`, carrier hex first.
 */
export function passLane(
  state: MoveActionState,
  carrierId: string,
  target: Cube,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  return lineCoverageCubes(carrier.at, target);
}

/**
 * Is the lane to `target` blocked by an opponent? `true` when an enemy stands on
 * any hex the lane covers (endpoints included). Teammates and obstacles never
 * block (obstacle blocking is deferred).
 */
export function passBlocked(
  state: MoveActionState,
  carrierId: string,
  target: Cube,
): boolean {
  const carrier = requireCarrier(state, carrierId);
  const enemies = enemyHexKeys(state, carrier.team);
  return lineCoverageCubes(carrier.at, target).some((h) =>
    enemies.has(cubeKey(h)),
  );
}

/** Every legal pass destination: {@link passRangeCubes} minus the shadowed hexes. */
export function passTargets(
  state: MoveActionState,
  carrierId: string,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  const enemies = enemyHexKeys(state, carrier.team);
  return passRangeCubes(state, carrierId).filter(
    (target) =>
      !lineCoverageCubes(carrier.at, target).some((h) =>
        enemies.has(cubeKey(h)),
      ),
  );
}

/** Is `target` a legal pass — in range and out of every opponent's shadow? */
export function canPass(
  state: MoveActionState,
  carrierId: string,
  target: Cube,
): boolean {
  return passTargets(state, carrierId).some((h) => cubeEquals(h, target));
}

/** The flight hexes of the lane to `target` — `lane[1..]`, the carrier excluded. */
function flightHexes(
  state: MoveActionState,
  carrier: Piece,
  target: Cube,
): Cube[] {
  return lineCoverageCubes(carrier.at, target).slice(1);
}

/**
 * Opponents who will get an interception roll on the pass to `target` — those
 * whose influence covers a flight hex (`lane[1..]`). Deduped, sorted by id. This
 * is the preview roster; the reducer rolls them one at a time in flight, in the
 * order the ball reaches them.
 */
export function passInterceptors(
  state: MoveActionState,
  carrierId: string,
  target: Cube,
): Piece[] {
  const carrier = requireCarrier(state, carrierId);
  const seen = new Set<string>();
  const out: Piece[] = [];
  for (const hex of flightHexes(state, carrier, target)) {
    for (const foe of influencers(state, hex, carrier.team)) {
      if (!seen.has(foe.id)) {
        seen.add(foe.id);
        out.push(foe);
      }
    }
  }
  return out.sort(byId);
}

/** The flight hexes an opponent flanks — the risky stretch, for the aim preview. */
export function passThreats(
  state: MoveActionState,
  carrierId: string,
  target: Cube,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  return flightHexes(state, carrier, target)
    .filter((hex) => influencers(state, hex, carrier.team).length > 0)
    .map(copy);
}

/** An {@link ArrowStyle} plus the hexes to draw it through — feeds `hexArrow`. */
export interface PassArrow extends ArrowStyle {
  hexes: Cube[];
}

/**
 * A solid straight {@link PassArrow} — **two points only**, the first and last
 * hex of `lane` (a kick is a straight flight; no corners along the supercover
 * path). Drop into `hexArrow(a.hexes, a)` or a `Scenario.arrows` entry. `null`
 * for a lane with fewer than two hexes. `style` overrides the solid-blue default.
 */
export function passArrow(
  lane: readonly Cube[],
  style?: ArrowStyle,
): PassArrow | null {
  if (lane.length < 2) return null;
  return {
    shape: "straight",
    dash: "solid",
    color: "#2d9cdb",
    ...style,
    hexes: [copy(lane[0]!), copy(lane[lane.length - 1]!)],
  };
}

/**
 * Land the ball on `dest`: a thin state patch. Whoever stands on `dest` becomes
 * the carrier ({@link ballCarrier}); if nobody does the ball is loose there.
 * Returns a fresh state.
 */
export function applyPass(state: MoveActionState, dest: Cube): MoveActionState {
  return { ...state, ball: copy(dest) };
}

// --- event reducer --------------------------------------------------------

/**
 * Where the pass is in the flow. `received` (a teammate collected it), `loose`
 * (it rests unclaimed on the target) and `intercepted` (an opponent picked it
 * off) are dead ends — `selectPiece` the new carrier or `cancel` to leave.
 */
export type PassPhase =
  | "idle"
  | "aiming"
  | "passing"
  | "received"
  | "loose"
  | "intercepted";

export type PassActionEvent =
  | { type: "selectPiece"; pieceId: string }
  | { type: "hoverHex"; hex: Cube | null }
  | { type: "commit"; hex?: Cube }
  | { type: "advance" }
  | { type: "cancel" };

/** One interception roll — which opponent, and what they got. */
export interface PassRoll {
  id: string;
  roll: number;
}

/** What happened when an opponent picked the pass off. */
export interface InterceptOutcome {
  /** Id of the opponent who took the ball. */
  by: string;
  /** Their hex — where the flight stopped. */
  at: Cube;
  /** Every interception roll made, in the order they were rolled. */
  rolls: PassRoll[];
}

/** The full, serialisable state of one pass in progress. */
export interface PassActionSnapshot {
  state: MoveActionState;
  phase: PassPhase;
  target: Cube | null;
  /** To `target` while aiming; the committed lane in flight. */
  lane: Cube[];
  /** Lane hexes the ball has travelled (flight). */
  ballIndex: number;
  /** Interceptors already rolled past — each opponent rolls once. */
  rolledIds: string[];
  /** Every interception roll so far, in order. */
  rolls: PassRoll[];
  /** Seeded PRNG — advances by one draw per interception roll. */
  rng: Rng;
  /** Set the frame a pick-off ends the pass (phase `intercepted`). */
  intercept: InterceptOutcome | null;
}

/**
 * One tick of the flight clock. `from` / `to` are consecutive **lane** hexes and
 * exist to *time* the interception rolls — the ball itself flies the straight
 * carrier → target line, so a renderer should draw it at `index / count` along
 * that straight line, not zig-zag through `to`.
 */
export interface PassStep {
  from: Cube;
  to: Cube;
  index: number;
  count: number;
  /** Ids of opponents rolled as the ball reaches `to` — one roll each. */
  contest: string[];
}

/** A flat frame for the renderer — everything it needs, nothing it doesn't. */
export interface PassActionView {
  phase: PassPhase;
  /** The passer — `null` once the ball has left. */
  carrier: Piece | null;
  pieces: readonly Piece[];
  ball: Cube | null;
  /** Legal destinations — `[]` unless aiming. */
  targets: Cube[];
  /** In-range hexes dropped by a shadow — `[]` unless aiming (for a greyed overlay). */
  blocked: Cube[];
  target: Cube | null;
  lane: Cube[];
  arrow: PassArrow | null;
  /** Flight hexes an opponent flanks — mark these on aim. */
  threats: Cube[];
  /** The lane hex currently in flight — `passing` only. Animate, dispatch `advance`, repeat. */
  step: PassStep | null;
  intercept: InterceptOutcome | null;
  /** `received` only — the teammate who collected the pass. */
  receiver: string | null;
}

const idleFields = (): Pick<
  PassActionSnapshot,
  "phase" | "target" | "lane" | "ballIndex" | "rolledIds" | "rolls" | "intercept"
> => ({
  phase: "idle",
  target: null,
  lane: [],
  ballIndex: 0,
  rolledIds: [],
  rolls: [],
  intercept: null,
});

/**
 * Start a pass over `state`, in the `idle` phase. `seed` fixes the dice: the
 * same seed replays every interception roll identically.
 */
export function initPassAction(
  state: MoveActionState,
  seed: number | string = 1,
): PassActionSnapshot {
  return { state, ...idleFields(), rng: seedRng(seed) };
}

/**
 * Apply one {@link PassActionEvent}. Pure: `snap` is never mutated, and an event
 * that does not apply (wrong phase, a non-carrier piece, a blocked target)
 * returns `snap` unchanged.
 */
export function passAction(
  snap: PassActionSnapshot,
  event: PassActionEvent,
): PassActionSnapshot {
  switch (event.type) {
    case "selectPiece": {
      if (snap.phase === "passing") return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier || carrier.id !== event.pieceId) return snap;
      return { ...snap, ...idleFields(), phase: "aiming" };
    }

    case "hoverHex": {
      if (snap.phase !== "aiming") return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier) return snap;
      if (!event.hex || !canPass(snap.state, carrier.id, event.hex)) {
        if (!snap.target) return snap;
        return { ...snap, target: null, lane: [] };
      }
      return {
        ...snap,
        target: copy(event.hex),
        lane: passLane(snap.state, carrier.id, event.hex),
      };
    }

    case "commit": {
      if (snap.phase !== "aiming") return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier) return snap;
      const hex = event.hex ?? snap.target;
      if (!hex || !canPass(snap.state, carrier.id, hex)) return snap;
      const lane = passLane(snap.state, carrier.id, hex);
      if (lane.length < 2) return snap;
      return {
        ...snap,
        phase: "passing",
        target: copy(hex),
        lane,
        ballIndex: 0,
        rolledIds: [],
        rolls: [],
        intercept: null,
      };
    }

    case "advance": {
      if (snap.phase !== "passing") return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier) return snap;
      const nextIndex = snap.ballIndex + 1;
      const hex = snap.lane[nextIndex];
      if (!hex) return snap;

      const die = snap.state.interceptDie ?? 6;
      const on = snap.state.interceptOn ?? DEFAULT_INTERCEPT_ON;
      const rolled = [...snap.rolledIds];
      const rolls = [...snap.rolls];
      let rng = snap.rng;
      let pickedBy: string | null = null;

      for (const foe of influencers(snap.state, hex, carrier.team)) {
        if (rolled.includes(foe.id)) continue;
        rolled.push(foe.id);
        const [roll, after] = rollDie(rng, die);
        rng = after;
        rolls.push({ id: foe.id, roll });
        if (pickedBy === null && roll >= on) pickedBy = foe.id;
      }

      if (pickedBy !== null) {
        const thief = snap.state.pieces.find((p) => p.id === pickedBy)!;
        return {
          ...snap,
          state: applyPass(snap.state, thief.at),
          phase: "intercepted",
          ballIndex: nextIndex,
          rolledIds: rolled,
          rolls,
          rng,
          intercept: { by: pickedBy, at: copy(thief.at), rolls },
        };
      }

      if (nextIndex < snap.lane.length - 1) {
        return { ...snap, ballIndex: nextIndex, rolledIds: rolled, rolls, rng };
      }

      const target = snap.target!;
      const landed = applyPass(snap.state, target);
      const onTarget = landed.pieces.some((p) => cubeEquals(p.at, target));
      return {
        ...snap,
        state: landed,
        phase: onTarget ? "received" : "loose",
        ballIndex: nextIndex,
        rolledIds: rolled,
        rolls,
        rng,
      };
    }

    case "cancel":
      if (snap.phase === "passing") return snap;
      return { ...snap, ...idleFields() };

    default:
      return snap;
  }
}

/** Derive the {@link PassActionView} for the current snapshot. */
export function passView(snap: PassActionSnapshot): PassActionView {
  const carrier = snap.phase === "aiming" ? ballCarrier(snap.state) : null;

  const targets = carrier ? passTargets(snap.state, carrier.id) : [];
  const blocked = carrier
    ? passRangeCubes(snap.state, carrier.id).filter((h) =>
        passBlocked(snap.state, carrier.id, h),
      )
    : [];
  const threats =
    carrier && snap.target
      ? passThreats(snap.state, carrier.id, snap.target)
      : [];

  let step: PassStep | null = null;
  if (snap.phase === "passing" && snap.ballIndex < snap.lane.length - 1) {
    const from = snap.lane[snap.ballIndex]!;
    const to = snap.lane[snap.ballIndex + 1]!;
    const passer = ballCarrier(snap.state);
    step = {
      from,
      to,
      index: snap.ballIndex,
      count: snap.lane.length - 1,
      contest: passer
        ? influencers(snap.state, to, passer.team)
            .map((p) => p.id)
            .filter((id) => !snap.rolledIds.includes(id))
        : [],
    };
  }

  const receiver =
    snap.phase === "received" && snap.target
      ? (snap.state.pieces.find((p) => cubeEquals(p.at, snap.target!))?.id ??
        null)
      : null;

  return {
    phase: snap.phase,
    carrier,
    pieces: snap.state.pieces,
    ball: snap.state.ball ?? null,
    targets,
    blocked,
    target: snap.target,
    lane: snap.lane,
    arrow: passArrow(snap.lane),
    threats,
    step,
    intercept: snap.intercept,
    receiver,
  };
}
