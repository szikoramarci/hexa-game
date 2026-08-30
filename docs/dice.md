# Session spec: dice (seeded rolls)

Goal: deterministic dice for game logic that must stay pure and replayable — a
functional PRNG whose whole state is one number you thread through calls. Same
seed in, same rolls out, forever.

## Scope

**In:** `src/dice/dice.ts` — `seedRng`, `nextRandom`, `rollDie`, `rollDice` +
tests. Consumed by `move-action` (the ball-steal check).

**Out (defer):** dice notation (`2d6+1`), weighted / exploding dice, a
stateful/class RNG, crypto randomness, shuffles.

## API

```ts
/** A PRNG's entire state, as a plain number. Thread it through every call. */
export type Rng = number;

/** Any number or string -> a starting Rng (never 0). */
export function seedRng(seed: number | string): Rng;

/** One draw: [value in [0, 1), next Rng]. mulberry32. */
export function nextRandom(rng: Rng): [value: number, next: Rng];

/** Roll one die: [result in 1..sides, next Rng]. `sides` default 6. */
export function rollDie(rng: Rng, sides?: number): [roll: number, next: Rng];

/** Roll `count` dice in sequence: [results, next Rng]. */
export function rollDice(rng: Rng, count: number, sides?: number): [rolls: number[], next: Rng];
```

- Pure. No hidden state, no `Math.random`. `[result, next]` tuples so the caller
  (or a snapshot) owns the state.
- `seedRng`: numbers are coerced to int32; strings are FNV-1a hashed; the result
  is forced non-zero.
- mulberry32 — fast, tiny, good enough for game rolls (not crypto).

## Tests

- Same seed -> identical sequence; different seeds diverge.
- `rollDie` stays in `1..sides`; over many rolls every face shows and the spread
  is roughly uniform.
- `rollDice(rng, n)` returns `n` results and its `next` equals threading
  `rollDie` `n` times.
- `seedRng`: deterministic for strings, stable for numbers, never returns 0,
  handles `""`.
- Determinism: identical calls -> identical output.

## Done when

- `npm run typecheck && npm test` pass.
- `Rng`, `seedRng`, `nextRandom`, `rollDie`, `rollDice` re-exported from
  `src/index.ts`.
- README "Layout" + "Planned utilities" updated.
