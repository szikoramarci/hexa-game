import {
  cubeEquals,
  cubeKey,
  type Cube,
} from "../coordinates/coordinates.js";
import type { ArrowStyle } from "../arrow/arrow.js";
import { cubeDistance } from "../distance/distance.js";
import { rollDie, seedRng, type Rng } from "../dice/dice.js";
import { lineCoverageCubes } from "../line-coverage/line-coverage.js";
import { looseBall, type LooseBallRoll } from "../loose-ball/loose-ball.js";
import { reachableCubes } from "../movement/movement.js";
import { pathCubes } from "../pathfind/pathfind.js";
import { pixelRangeCubes } from "../pixel-range/pixel-range.js";
import {
  ballCarrier,
  blockersFor,
  type MoveActionState,
  type Piece,
} from "../move-action/move-action.js";

/**
 * The high pass — the carrier lofts the ball to a hex a chosen teammate runs
 * onto. It composes the existing lego (`pixelRangeCubes` for the reach,
 * `lineCoverageCubes` for the shadow, `reachableCubes` / `pathCubes` for the
 * reaction moves, `looseBall` for a wayward loft, `dice` for the accuracy and
 * header rolls) and touches no DOM, no timers. A sibling **action** to
 * `move-action` / `pass-action`, sharing `MoveActionState` / `Piece` and the
 * `ballCarrier` / `blockersFor` helpers.
 *
 * Use it either way:
 * - **direct** — {@link highPassTargets}, {@link highPassLandingZone},
 *   {@link reactReach}, {@link headerContestants}, {@link applyHighPass};
 * - **event reducer** — {@link initHighPass} / {@link highPassAction} /
 *   {@link highPassView}, walked through
 *   `idle -> receiver -> aiming -> reacting -> rolling -> flight -> (headed | loose)`.
 *
 * **Shadow.** Only opponents standing *next to* the carrier block a loft — you
 * cannot clear a man who is on top of you. **Min distance.** A loft skips the
 * first three rings; the ball lands at least four hexes away. **Reactions.**
 * Once the landing hex is locked the receiver, one opponent, and (in the box)
 * the keeper each get a repositioning move. **Accuracy.** `d6 + highPass >= 8`
 * lands it on the spot; a miss scatters with {@link looseBall}. **Header.**
 * Everyone within two hexes of where it lands contests `d6 + heading/aerial`
 * (two hexes out: minus one); the highest wins.
 *
 * See `docs/high-pass.md` and `docs/domain-model.md` "Passing -> High pass".
 */

const DEFAULT_HIGH_PASS_RANGE = 8;
const DEFAULT_ACCURACY_ON = 8;
/** A loft clears the carrier hex and the first three rings. */
const MIN_LOFT_DISTANCE = 4;
/** Hexes the receiver may run onto the ball after the kick. */
const RECEIVER_RUN = 3;
/** Hexes the reacting outfield opponent may move. */
const REACTION_BUDGET = 3;
const KEEPER_STEP = 1;
const KEEPER_CHALLENGE_STEP = 4;
/** A keeper this close to the landing hex gets the bigger challenge move. */
const KEEPER_CHALLENGE_RANGE = 5;

const copy = (c: Cube): Cube => ({ x: c.x, y: c.y, z: c.z });
const byId = (a: Piece, b: Piece): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** An attribute of `piece`, or the state default (`3`). */
function attr(
  state: MoveActionState,
  piece: Piece,
  key: "heading" | "aerial" | "highPass",
): number {
  return piece.attrs?.[key] ?? state.defaultAttr ?? 3;
}

/** The aerial attribute for a header — `aerial` for a keeper, `heading` otherwise. */
function aerialAttr(state: MoveActionState, piece: Piece): number {
  return piece.role === "goalkeeper"
    ? attr(state, piece, "aerial")
    : attr(state, piece, "heading");
}

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

/** A teammate of `carrier` (not the carrier itself). Throws otherwise. */
function requireReceiver(
  state: MoveActionState,
  carrier: Piece,
  receiverId: string,
): Piece {
  const receiver = state.pieces.find((p) => p.id === receiverId);
  if (!receiver) {
    throw new RangeError(`no piece with id ${JSON.stringify(receiverId)}`);
  }
  if (receiver.id === carrier.id || receiver.team !== carrier.team) {
    throw new RangeError(
      `piece ${JSON.stringify(receiverId)} is not a teammate of the carrier`,
    );
  }
  return receiver;
}

/** Opponents of `carrier` standing exactly one hex away — the only shadow casters. */
function adjacentFoes(state: MoveActionState, carrier: Piece): Piece[] {
  return state.pieces
    .filter(
      (p) => p.team !== carrier.team && cubeDistance(p.at, carrier.at) === 1,
    )
    .sort(byId);
}

/**
 * The lofted reach — `pixelRangeCubes(carrier.at, highPassRange)` with every hex
 * closer than {@link MIN_LOFT_DISTANCE} removed (the carrier hex and the first
 * three rings). Shadows are *not* applied here; see {@link highPassLandingZone}.
 */
export function highPassRangeCubes(
  state: MoveActionState,
  carrierId: string,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  const range = state.highPassRange ?? DEFAULT_HIGH_PASS_RANGE;
  return pixelRangeCubes(carrier.at, range).filter(
    (h) => cubeDistance(carrier.at, h) >= MIN_LOFT_DISTANCE,
  );
}

/** The hexes of the carrier-adjacent opponents casting a shadow. */
export function highPassShadow(
  state: MoveActionState,
  carrierId: string,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  return adjacentFoes(state, carrier).map((p) => copy(p.at));
}

/**
 * Is the loft to `target` blocked? `true` when the straight lane from the
 * carrier covers a hex an opponent standing *next to the carrier* occupies.
 * Non-adjacent opponents, teammates and obstacles never block.
 */
export function highPassBlocked(
  state: MoveActionState,
  carrierId: string,
  target: Cube,
): boolean {
  const carrier = requireCarrier(state, carrierId);
  const shadow = new Set(adjacentFoes(state, carrier).map((p) => cubeKey(p.at)));
  if (shadow.size === 0) return false;
  return lineCoverageCubes(carrier.at, target).some((h) =>
    shadow.has(cubeKey(h)),
  );
}

/** {@link highPassRangeCubes} minus every hex a carrier-adjacent opponent shadows. */
export function highPassLandingZone(
  state: MoveActionState,
  carrierId: string,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  const shadow = new Set(adjacentFoes(state, carrier).map((p) => cubeKey(p.at)));
  return highPassRangeCubes(state, carrierId).filter(
    (h) =>
      shadow.size === 0 ||
      !lineCoverageCubes(carrier.at, h).some((c) => shadow.has(cubeKey(c))),
  );
}

/**
 * Every teammate the carrier could actually loft to — a teammate is a legal
 * receiver only if {@link highPassTargets} for it is non-empty, i.e. it can
 * **run to** at least one hex in the landing zone. A teammate the opponent's
 * shadow shuts out of the zone entirely (even after its 3-hex run) is not
 * offered. Sorted by id, carrier excluded.
 */
export function highPassReceivers(
  state: MoveActionState,
  carrierId: string,
): Piece[] {
  const carrier = requireCarrier(state, carrierId);
  return state.pieces
    .filter((p) => p.id !== carrier.id && p.team === carrier.team)
    .filter((p) => highPassTargets(state, carrierId, p.id).length > 0)
    .sort(byId);
}

/**
 * Legal landing hexes for a loft aimed at `receiverId` — the landing zone
 * intersected with the hexes the receiver can actually **run to** in
 * {@link RECEIVER_RUN} steps: `reachableCubes` from its hex around
 * {@link blockersFor} (obstacles and every other piece block the run), its own
 * hex kept (it may already be there). Reactions have not happened yet, so this
 * is the same snapshot the receiver will run in.
 */
export function highPassTargets(
  state: MoveActionState,
  carrierId: string,
  receiverId: string,
): Cube[] {
  const carrier = requireCarrier(state, carrierId);
  const receiver = requireReceiver(state, carrier, receiverId);
  const zone = new Set(
    highPassLandingZone(state, carrierId).map((h) => cubeKey(h)),
  );
  return reachableCubes(
    receiver.at,
    RECEIVER_RUN,
    blockersFor(state, receiver.id),
  ).filter((h) => zone.has(cubeKey(h)));
}

/** Is `target` a legal loft to `receiverId`? */
export function canHighPass(
  state: MoveActionState,
  carrierId: string,
  receiverId: string,
  target: Cube,
): boolean {
  return highPassTargets(state, carrierId, receiverId).some((h) =>
    cubeEquals(h, target),
  );
}

/** An {@link ArrowStyle} plus the two hexes to draw it through — feeds `hexArrow`. */
export interface HighPassArrow extends ArrowStyle {
  hexes: Cube[];
}

/**
 * A lofted {@link HighPassArrow} — a **two-hex jump arc** (`shape: "curved"`,
 * `[from, to]`), the ball leaving the ground and landing again. `null` when
 * `from` and `to` coincide. `style` overrides the solid-blue default.
 */
export function highPassArrow(
  from: Cube,
  to: Cube,
  style?: ArrowStyle,
): HighPassArrow | null {
  if (cubeEquals(from, to)) return null;
  return {
    shape: "curved",
    dash: "solid",
    color: "#2d9cdb",
    bow: 0.28,
    ...style,
    hexes: [copy(from), copy(to)],
  };
}

/**
 * Hexes a reacting piece can move to — `reachableCubes` from its hex within
 * `budget`, around {@link blockersFor}, its own hex removed.
 */
export function reactReach(
  state: MoveActionState,
  reactorId: string,
  budget: number,
): Cube[] {
  const reactor = state.pieces.find((p) => p.id === reactorId);
  if (!reactor) {
    throw new RangeError(`no piece with id ${JSON.stringify(reactorId)}`);
  }
  if (!Number.isInteger(budget) || budget < 0) {
    throw new RangeError(`budget must be a non-negative integer, got ${budget}`);
  }
  return reachableCubes(
    reactor.at,
    budget,
    blockersFor(state, reactorId),
  ).filter((h) => !cubeEquals(h, reactor.at));
}

/** One piece in a header contest — its distance ring and the attr it brings. */
export interface HeaderEntry {
  id: string;
  /** Cube distance to the ball's landing hex. */
  dist: 0 | 1 | 2;
  /** Aerial attr, already `-1` when `reduced`. */
  attr: number;
  /** `true` at distance 2 — the header is a stretch, `-1` to the attr. */
  reduced: boolean;
}

/**
 * Everyone contesting a header at `ballHex` — pieces within two hexes. Distance
 * 0 / 1 bring the full aerial attr (`aerial` for a keeper, `heading` for an
 * outfielder), distance 2 brings it `-1`. Ordered by ascending distance, then by
 * id, so a seed replays.
 */
export function headerContestants(
  state: MoveActionState,
  ballHex: Cube,
): HeaderEntry[] {
  const near = state.pieces
    .map((p) => ({ p, dist: cubeDistance(p.at, ballHex) }))
    .filter((e) => e.dist <= 2)
    .sort((a, b) => a.dist - b.dist || byId(a.p, b.p));
  return near.map(({ p, dist }) => {
    const base = aerialAttr(state, p);
    const reduced = dist === 2;
    return {
      id: p.id,
      dist: dist as 0 | 1 | 2,
      attr: reduced ? base - 1 : base,
      reduced,
    };
  });
}

/**
 * Land the ball on `dest`: a thin state patch (like `applyPass`). Returns a
 * fresh state; whoever the rules layer puts on `dest` next becomes the carrier.
 */
export function applyHighPass(
  state: MoveActionState,
  dest: Cube,
): MoveActionState {
  return { ...state, ball: copy(dest) };
}

// --- event reducer --------------------------------------------------------

/**
 * Where the high pass is in the flow. `headed` (a contestant won the header) and
 * `loose` (a tie, or nobody near — the ball spilled) are dead ends; the header
 * follow-up (pass vs shot) is a later session. Leave via `selectPiece` /
 * `cancel`.
 */
export type HighPassPhase =
  | "idle"
  | "receiver"
  | "aiming"
  | "reacting"
  | "rolling"
  | "flight"
  | "headed"
  | "loose";

export type HighPassEvent =
  | { type: "selectPiece"; pieceId: string }
  | { type: "selectReceiver"; pieceId: string }
  | { type: "hoverHex"; hex: Cube | null }
  | { type: "commit"; hex?: Cube }
  | { type: "reactPiece"; pieceId: string }
  | { type: "reactMove"; hex: Cube }
  | { type: "reactSkip" }
  | { type: "advance" }
  | { type: "cancel" };

/** One reaction move in the queue built when the landing hex is locked. */
export interface ReactionSlot {
  role: "receiver" | "opponent" | "keeper";
  /** `null` only for the opponent slot until `reactPiece` picks one. */
  pieceId: string | null;
  /** Hexes the piece may travel. */
  budget: number;
  /** The route it took, once resolved — `[at]` when it stayed. `null` while pending. */
  path: Cube[] | null;
}

/** The passer's accuracy roll — `d6 + highPass`. */
export interface AccuracyRoll {
  roll: number;
  attr: number;
  score: number;
  /** `score >= state.highPassAccuracyOn ?? 8`. */
  accurate: boolean;
}

/** One header contest roll. */
export interface HeaderRoll extends HeaderEntry {
  roll: number;
  score: number;
}

/** How the header at the landing hex resolved. */
export interface HeaderOutcome {
  at: Cube;
  /** Every contest roll, in contest order (ascending distance, then id). */
  rolls: HeaderRoll[];
  /** Highest score wins; `null` on a tie (or nobody near) — the ball is loose. */
  winner: string | null;
}

/** The full, serialisable state of one high pass in progress. */
export interface HighPassSnapshot {
  state: MoveActionState;
  phase: HighPassPhase;
  receiverId: string | null;
  /** The locked landing hex. */
  target: Cube | null;
  /** The carrier's hex when the loft was committed — the arc's start. */
  origin: Cube | null;
  /** Built at `commit`; each slot resolved in order during `reacting`. */
  reactions: ReactionSlot[];
  reactionIndex: number;
  /** Set on the accuracy roll (phase `flight` onward). */
  accuracy: AccuracyRoll | null;
  /** Set only on an inaccurate loft — the scatter from the target hex. */
  scatter: LooseBallRoll | null;
  /** Where the ball actually comes down — `target`, or `scatter.rest`. */
  arrivalHex: Cube | null;
  /** Arc-animation ticks done (phase `flight`). */
  flightIndex: number;
  /** Set when the header resolves (phase `headed` / `loose`). */
  header: HeaderOutcome | null;
  /** Seeded PRNG — one draw for accuracy, two for a scatter, one per header roll. */
  rng: Rng;
}

/** One tick of the loft's flight clock — interpolate `from -> to` at `index / count`. */
export interface HighPassStep {
  from: Cube;
  to: Cube;
  index: number;
  count: number;
}

/** The current reactor and what it may do — `reacting` only. */
export interface ReactionView {
  role: "receiver" | "opponent" | "keeper";
  piece: Piece | null;
  budget: number;
  /** {@link reactReach} for the reactor — `[]` until an opponent is picked. */
  reach: Cube[];
  /** `true` while waiting on `reactPiece`. */
  needsPiece: boolean;
  /** Opponent picks — id-sorted. Only while `needsPiece`. */
  candidates: Piece[];
}

/** A flat frame for the renderer — everything it needs, nothing it doesn't. */
export interface HighPassView {
  phase: HighPassPhase;
  /** The passer — `null` once the ball has come down. */
  carrier: Piece | null;
  pieces: readonly Piece[];
  ball: Cube | null;
  /** Legal receivers — `receiver` phase only. */
  receivers: Piece[];
  receiver: Piece | null;
  /** Legal landing hexes for the chosen receiver — `aiming` only. */
  targets: Cube[];
  /** In-range hexes a shadow drops — `aiming` only, for a greyed overlay. */
  blocked: Cube[];
  /** Carrier-adjacent opponent hexes casting the shadow — `aiming` only. */
  shadow: Cube[];
  target: Cube | null;
  arrow: HighPassArrow | null;
  /** The current reaction move — `reacting` only. */
  reaction: ReactionView | null;
  accuracy: AccuracyRoll | null;
  scatter: (LooseBallRoll & { from: Cube }) | null;
  /** Where the ball comes down — known from the accuracy roll on. */
  arrival: Cube | null;
  /** The loft in flight — animate `from -> to`, dispatch `advance`, repeat. */
  step: HighPassStep | null;
  header: HeaderOutcome | null;
  /** The header roster at the arrival hex — a preview once `arrival` is known. */
  contestants: HeaderEntry[];
}

const ACTIVE_PHASES = new Set<HighPassPhase>([
  "receiver",
  "aiming",
  "reacting",
  "rolling",
  "flight",
]);

const idleFields = (): Omit<HighPassSnapshot, "state" | "rng"> => ({
  phase: "idle",
  receiverId: null,
  target: null,
  origin: null,
  reactions: [],
  reactionIndex: 0,
  accuracy: null,
  scatter: null,
  arrivalHex: null,
  flightIndex: 0,
  header: null,
});

/**
 * Start a high pass over `state`, in the `idle` phase. `seed` fixes the dice:
 * the same seed replays the accuracy roll, any scatter and every header roll.
 */
export function initHighPass(
  state: MoveActionState,
  seed: number | string = 1,
): HighPassSnapshot {
  return { state, ...idleFields(), rng: seedRng(seed) };
}

/** Opponents that may be picked for the outfield reaction — keeper excluded when it has its own slot. */
function opponentCandidates(
  state: MoveActionState,
  carrier: Piece,
  slots: readonly ReactionSlot[],
): Piece[] {
  const hasKeeperSlot = slots.some((s) => s.role === "keeper");
  return state.pieces
    .filter((p) => p.team !== carrier.team)
    .filter((p) => !(hasKeeperSlot && p.role === "goalkeeper"))
    .sort(byId);
}

/** The reaction queue for a loft landing on `landing`. */
function buildReactions(
  state: MoveActionState,
  carrier: Piece,
  receiver: Piece,
  landing: Cube,
): ReactionSlot[] {
  const slots: ReactionSlot[] = [
    { role: "receiver", pieceId: receiver.id, budget: RECEIVER_RUN, path: null },
    { role: "opponent", pieceId: null, budget: REACTION_BUDGET, path: null },
  ];
  const inBox = (state.penaltyArea ?? []).some((h) => cubeEquals(h, landing));
  if (inBox) {
    const keeper = state.pieces.find(
      (p) => p.team !== carrier.team && p.role === "goalkeeper",
    );
    if (keeper) {
      const budget =
        cubeDistance(keeper.at, landing) <= KEEPER_CHALLENGE_RANGE
          ? KEEPER_CHALLENGE_STEP
          : KEEPER_STEP;
      slots.push({ role: "keeper", pieceId: keeper.id, budget, path: null });
    }
  }
  return slots;
}

const withPath = (
  slots: readonly ReactionSlot[],
  index: number,
  path: Cube[],
): ReactionSlot[] =>
  slots.map((s, i) => (i === index ? { ...s, path } : { ...s }));

/** Step to the next reaction slot, or on to the accuracy roll when the queue is done. */
function advanceReactions(snap: HighPassSnapshot): HighPassSnapshot {
  const nextIndex = snap.reactionIndex + 1;
  if (nextIndex >= snap.reactions.length) {
    return { ...snap, reactionIndex: nextIndex, phase: "rolling" };
  }
  return { ...snap, reactionIndex: nextIndex };
}

/** The straight-line span of the loft, for the flight clock. */
function flightCount(snap: HighPassSnapshot): number {
  if (!snap.origin || !snap.arrivalHex) return 1;
  return Math.max(1, cubeDistance(snap.origin, snap.arrivalHex));
}

/** Roll the header contest at the arrival hex and settle the pass. */
function resolveHeader(snap: HighPassSnapshot): HighPassSnapshot {
  const arrival = snap.arrivalHex!;
  const entries = headerContestants(snap.state, arrival);
  const die = snap.state.stealDie ?? 6;
  let rng = snap.rng;
  const rolls: HeaderRoll[] = [];
  for (const e of entries) {
    const [roll, after] = rollDie(rng, die);
    rng = after;
    rolls.push({ ...e, roll, score: roll + e.attr });
  }
  let winner: string | null = null;
  if (rolls.length > 0) {
    const top = Math.max(...rolls.map((r) => r.score));
    const leaders = rolls.filter((r) => r.score === top);
    if (leaders.length === 1) winner = leaders[0]!.id;
  }
  return {
    ...snap,
    state: applyHighPass(snap.state, arrival),
    rng,
    header: { at: copy(arrival), rolls, winner },
    phase: winner ? "headed" : "loose",
  };
}

/**
 * Apply one {@link HighPassEvent}. Pure: `snap` is never mutated, and an event
 * that does not apply (wrong phase, a non-carrier / non-teammate / non-opponent
 * piece, an unreachable hex) returns `snap` unchanged.
 */
export function highPassAction(
  snap: HighPassSnapshot,
  event: HighPassEvent,
): HighPassSnapshot {
  switch (event.type) {
    case "selectPiece": {
      if (snap.phase === "flight") return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier || carrier.id !== event.pieceId) return snap;
      return { ...snap, ...idleFields(), phase: "receiver" };
    }

    case "selectReceiver": {
      if (snap.phase !== "receiver") return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier) return snap;
      const receiver = highPassReceivers(snap.state, carrier.id).find(
        (p) => p.id === event.pieceId,
      );
      if (!receiver) return snap;
      return { ...snap, phase: "aiming", receiverId: receiver.id, target: null };
    }

    case "hoverHex": {
      if (snap.phase !== "aiming" || !snap.receiverId) return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier) return snap;
      if (
        !event.hex ||
        !canHighPass(snap.state, carrier.id, snap.receiverId, event.hex)
      ) {
        if (!snap.target) return snap;
        return { ...snap, target: null };
      }
      return { ...snap, target: copy(event.hex) };
    }

    case "commit": {
      if (snap.phase !== "aiming" || !snap.receiverId) return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier) return snap;
      const hex = event.hex ?? snap.target;
      if (!hex || !canHighPass(snap.state, carrier.id, snap.receiverId, hex)) {
        return snap;
      }
      const receiver = snap.state.pieces.find((p) => p.id === snap.receiverId)!;
      return {
        ...snap,
        phase: "reacting",
        target: copy(hex),
        origin: copy(carrier.at),
        reactions: buildReactions(snap.state, carrier, receiver, hex),
        reactionIndex: 0,
      };
    }

    case "reactPiece": {
      if (snap.phase !== "reacting") return snap;
      const slot = snap.reactions[snap.reactionIndex];
      if (!slot || slot.role !== "opponent" || slot.pieceId) return snap;
      const carrier = ballCarrier(snap.state);
      if (!carrier) return snap;
      const ok = opponentCandidates(snap.state, carrier, snap.reactions).some(
        (p) => p.id === event.pieceId,
      );
      if (!ok) return snap;
      return {
        ...snap,
        reactions: snap.reactions.map((s, i) =>
          i === snap.reactionIndex ? { ...s, pieceId: event.pieceId } : { ...s },
        ),
      };
    }

    case "reactMove": {
      if (snap.phase !== "reacting") return snap;
      const slot = snap.reactions[snap.reactionIndex];
      if (!slot || !slot.pieceId) return snap;
      const reach = reactReach(snap.state, slot.pieceId, slot.budget);
      if (!reach.some((h) => cubeEquals(h, event.hex))) return snap;
      const piece = snap.state.pieces.find((p) => p.id === slot.pieceId)!;
      const path =
        pathCubes(piece.at, event.hex, blockersFor(snap.state, slot.pieceId)) ??
        [copy(piece.at), copy(event.hex)];
      const state: MoveActionState = {
        ...snap.state,
        pieces: snap.state.pieces.map((p) =>
          p.id === slot.pieceId ? { ...p, at: copy(event.hex) } : p,
        ),
      };
      return advanceReactions({
        ...snap,
        state,
        reactions: withPath(snap.reactions, snap.reactionIndex, path.map(copy)),
      });
    }

    case "reactSkip": {
      if (snap.phase !== "reacting") return snap;
      const slot = snap.reactions[snap.reactionIndex];
      if (!slot) return snap;
      const reactor = slot.pieceId
        ? (snap.state.pieces.find((p) => p.id === slot.pieceId) ?? null)
        : null;
      return advanceReactions({
        ...snap,
        reactions: withPath(
          snap.reactions,
          snap.reactionIndex,
          reactor ? [copy(reactor.at)] : [],
        ),
      });
    }

    case "advance": {
      if (snap.phase === "rolling") {
        const carrier = ballCarrier(snap.state);
        if (!carrier || !snap.target) return snap;
        const die = snap.state.stealDie ?? 6;
        const [roll, r1] = rollDie(snap.rng, die);
        const a = attr(snap.state, carrier, "highPass");
        const on = snap.state.highPassAccuracyOn ?? DEFAULT_ACCURACY_ON;
        const accuracy: AccuracyRoll = {
          roll,
          attr: a,
          score: roll + a,
          accurate: roll + a >= on,
        };
        if (accuracy.accurate) {
          return {
            ...snap,
            phase: "flight",
            rng: r1,
            accuracy,
            arrivalHex: copy(snap.target),
            flightIndex: 0,
          };
        }
        const scatter = looseBall(r1, snap.target, [], die);
        return {
          ...snap,
          phase: "flight",
          rng: scatter.rng,
          accuracy,
          scatter,
          arrivalHex: copy(scatter.rest),
          flightIndex: 0,
        };
      }

      if (snap.phase === "flight") {
        const count = flightCount(snap);
        const nextIndex = snap.flightIndex + 1;
        if (nextIndex < count) {
          return { ...snap, flightIndex: nextIndex };
        }
        return resolveHeader({ ...snap, flightIndex: count });
      }

      return snap;
    }

    case "cancel":
      if (snap.phase === "flight") return snap;
      return { ...snap, ...idleFields() };

    default:
      return snap;
  }
}

/** Derive the {@link HighPassView} for the current snapshot. */
export function highPassView(snap: HighPassSnapshot): HighPassView {
  const carrier = ACTIVE_PHASES.has(snap.phase)
    ? ballCarrier(snap.state)
    : null;

  const receivers =
    snap.phase === "receiver" && carrier
      ? highPassReceivers(snap.state, carrier.id)
      : [];

  const receiver =
    snap.receiverId != null
      ? (snap.state.pieces.find((p) => p.id === snap.receiverId) ?? null)
      : null;

  const targets =
    snap.phase === "aiming" && carrier && snap.receiverId
      ? highPassTargets(snap.state, carrier.id, snap.receiverId)
      : [];

  const blocked =
    snap.phase === "aiming" && carrier
      ? highPassRangeCubes(snap.state, carrier.id).filter((h) =>
          highPassBlocked(snap.state, carrier.id, h),
        )
      : [];

  const shadow =
    snap.phase === "aiming" && carrier
      ? highPassShadow(snap.state, carrier.id)
      : [];

  const arrowFrom = snap.origin ?? carrier?.at ?? null;
  const arrow =
    arrowFrom && snap.target ? highPassArrow(arrowFrom, snap.target) : null;

  let reaction: ReactionView | null = null;
  if (snap.phase === "reacting") {
    const slot = snap.reactions[snap.reactionIndex];
    if (slot) {
      const needsPiece = slot.role === "opponent" && !slot.pieceId;
      reaction = {
        role: slot.role,
        piece: slot.pieceId
          ? (snap.state.pieces.find((p) => p.id === slot.pieceId) ?? null)
          : null,
        budget: slot.budget,
        reach: slot.pieceId
          ? reactReach(snap.state, slot.pieceId, slot.budget)
          : [],
        needsPiece,
        candidates:
          needsPiece && carrier
            ? opponentCandidates(snap.state, carrier, snap.reactions)
            : [],
      };
    }
  }

  let step: HighPassStep | null = null;
  if (snap.phase === "flight" && snap.origin && snap.arrivalHex) {
    const count = flightCount(snap);
    if (snap.flightIndex < count) {
      step = {
        from: copy(snap.origin),
        to: copy(snap.arrivalHex),
        index: snap.flightIndex,
        count,
      };
    }
  }

  const contestants = snap.arrivalHex
    ? headerContestants(snap.state, snap.arrivalHex)
    : [];

  return {
    phase: snap.phase,
    carrier,
    pieces: snap.state.pieces,
    ball: snap.state.ball ?? null,
    receivers,
    receiver,
    targets,
    blocked,
    shadow,
    target: snap.target,
    arrow,
    reaction,
    accuracy: snap.accuracy,
    scatter: snap.scatter
      ? { ...snap.scatter, from: copy(snap.target ?? snap.scatter.route[0]!) }
      : null,
    arrival: snap.arrivalHex,
    step,
    header: snap.header,
    contestants,
  };
}
