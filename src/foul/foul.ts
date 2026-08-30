import { rollDie, type Rng } from "../dice/dice.js";

/**
 * Foul — the aftermath of a tackle where the defender's raw challenge die comes
 * up `1`. The comparison is void (the fouled carrier keeps the ball); instead
 * the referee steps in with two `d6` checks, always both:
 *
 * - **injury** — `d6 >= resilience` of the fouled carrier → the `injured` tag,
 *   `-2` move points, and it sticks (a future turn refresh keeps re-applying it).
 * - **card** — `d6 >= refereeLeniency` (`3..6`, rolled once at kick-off) → a
 *   yellow for the fouler. His second yellow is a red: sent off, game stopped.
 *
 * Performing the free kick / penalty that follows is deferred to the rules
 * layer. See `docs/foul.md` and `docs/domain-model.md` "Challenges".
 */

/** The tackle-specific foul trigger: the defender's raw challenge die is `1`. */
export function tackleFoul(defenderRoll: number): boolean {
  return defenderRoll === 1;
}

/** How the referee's two checks fell after a foul. */
export interface FoulRoll {
  /** Raw injury `d<die>`, `1..die`. */
  injuryRoll: number;
  /** `injuryRoll >= carrierResilience` — the carrier picks up a knock. */
  injured: boolean;
  /** Raw card `d<die>`, `1..die`. */
  cardRoll: number;
  /** `cardRoll >= refereeLeniency` — the fouler is booked. */
  booked: boolean;
  /** The fouler's yellow-card count *after* this foul (`foulerYellows` + 0 or 1). */
  yellows: number;
  /** `yellows >= 2` — a second yellow, so a red: sent off, game stopped. */
  sentOff: boolean;
  /** The `Rng` after both draws — injury first, then card. */
  rng: Rng;
}

/**
 * Roll the referee's response to a foul: a `d<die>` injury check against the
 * fouled carrier's `resilience`, then a `d<die>` card check against
 * `refereeLeniency`. Pure; advances `rng` by exactly two draws.
 */
export function resolveFoul(
  rng: Rng,
  carrierResilience: number,
  foulerYellows: number,
  refereeLeniency: number,
  die = 6,
): FoulRoll {
  const [injuryRoll, r1] = rollDie(rng, die);
  const [cardRoll, r2] = rollDie(r1, die);
  const injured = injuryRoll >= carrierResilience;
  const booked = cardRoll >= refereeLeniency;
  const yellows = foulerYellows + (booked ? 1 : 0);
  return {
    injuryRoll,
    injured,
    cardRoll,
    booked,
    yellows,
    sentOff: yellows >= 2,
    rng: r2,
  };
}

/** Move points a piece has lost to injury — `2` when `injured`, else `0`. */
export function pacePenalty(piece: { injured?: boolean }): number {
  return piece.injured ? 2 : 0;
}
