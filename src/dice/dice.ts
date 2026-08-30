/**
 * Deterministic dice. The generator's entire state is one number ({@link Rng});
 * every call returns its result **and** the next `Rng` to pass on, so nothing is
 * hidden and a game snapshot can carry the seed and replay exactly.
 *
 * ```ts
 * let rng = seedRng("match-42");
 * let roll;
 * [roll, rng] = rollDie(rng);      // 1..6
 * [roll, rng] = rollDie(rng, 20);  // 1..20
 * ```
 */

/** A PRNG's whole state, as a plain number. Thread it through every call. */
export type Rng = number;

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** Coerce any number or string into a starting {@link Rng} (never `0`). */
export function seedRng(seed: number | string): Rng {
  if (typeof seed === "number") {
    return (seed | 0) || 1;
  }
  let h = FNV_OFFSET;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return (h | 0) || 1;
}

/**
 * One step of the generator (mulberry32). Returns `[value, next]` with `value`
 * uniform in `[0, 1)`.
 */
export function nextRandom(rng: Rng): [value: number, next: Rng] {
  const a = (rng + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

/**
 * Roll one `sides`-sided die (default 6). Returns `[result, next]` with
 * `result` an integer in `1..sides`.
 */
export function rollDie(rng: Rng, sides = 6): [roll: number, next: Rng] {
  const [value, next] = nextRandom(rng);
  return [Math.floor(value * sides) + 1, next];
}

/**
 * Roll `count` dice one after another. Returns `[results, next]` — `results` has
 * `count` entries and `next` is the state after all of them.
 */
export function rollDice(
  rng: Rng,
  count: number,
  sides = 6,
): [rolls: number[], next: Rng] {
  const rolls: number[] = [];
  let state = rng;
  for (let i = 0; i < count; i++) {
    const [roll, next] = rollDie(state, sides);
    rolls.push(roll);
    state = next;
  }
  return [rolls, state];
}
