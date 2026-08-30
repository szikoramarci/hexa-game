import { describe, expect, it } from "vitest";
import { nextRandom, rollDice, rollDie, seedRng, type Rng } from "./dice.js";

/** Draw `n` values from a fresh seed. */
function sequence(seed: number | string, n: number): number[] {
  const out: number[] = [];
  let rng = seedRng(seed);
  for (let i = 0; i < n; i++) {
    const [v, next] = nextRandom(rng);
    out.push(v);
    rng = next;
  }
  return out;
}

describe("seedRng", () => {
  it("is deterministic for strings and stable for numbers", () => {
    expect(seedRng("hello")).toBe(seedRng("hello"));
    expect(seedRng(42)).toBe(42);
  });

  it("never returns zero", () => {
    expect(seedRng(0)).not.toBe(0);
    expect(seedRng("")).not.toBe(0);
  });

  it("separates similar strings", () => {
    expect(seedRng("match-1")).not.toBe(seedRng("match-2"));
  });
});

describe("nextRandom", () => {
  it("replays exactly from the same seed", () => {
    expect(sequence("seed", 8)).toEqual(sequence("seed", 8));
  });

  it("diverges for different seeds", () => {
    expect(sequence("a", 5)).not.toEqual(sequence("b", 5));
  });

  it("stays in [0, 1)", () => {
    for (const v of sequence(123, 500)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("rollDie", () => {
  it("stays within 1..sides", () => {
    let rng: Rng = seedRng("dice");
    for (let i = 0; i < 2000; i++) {
      const [roll, next] = rollDie(rng, 6);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
      expect(Number.isInteger(roll)).toBe(true);
      rng = next;
    }
  });

  it("covers every face with a roughly even spread", () => {
    const counts = new Array(7).fill(0);
    let rng: Rng = seedRng("spread");
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const [roll, next] = rollDie(rng, 6);
      counts[roll]++;
      rng = next;
    }
    for (let face = 1; face <= 6; face++) {
      expect(counts[face]).toBeGreaterThan((n / 6) * 0.9);
      expect(counts[face]).toBeLessThan((n / 6) * 1.1);
    }
  });

  it("honours a custom side count", () => {
    let rng: Rng = seedRng(7);
    let max = 0;
    for (let i = 0; i < 500; i++) {
      const [roll, next] = rollDie(rng, 20);
      expect(roll).toBeLessThanOrEqual(20);
      max = Math.max(max, roll);
      rng = next;
    }
    expect(max).toBeGreaterThan(15);
  });
});

describe("rollDice", () => {
  it("returns `count` rolls and the state after threading rollDie", () => {
    const seed = seedRng("batch");
    const [rolls, after] = rollDice(seed, 4, 6);
    expect(rolls).toHaveLength(4);

    let rng = seed;
    for (let i = 0; i < 4; i++) rng = rollDie(rng, 6)[1];
    expect(after).toBe(rng);
    expect(rolls).toEqual([
      rollDie(seed, 6)[0],
      ...(() => {
        const r: number[] = [];
        let s = rollDie(seed, 6)[1];
        for (let i = 0; i < 3; i++) {
          const [v, n] = rollDie(s, 6);
          r.push(v);
          s = n;
        }
        return r;
      })(),
    ]);
  });

  it("is deterministic", () => {
    expect(rollDice(seedRng("x"), 10)).toEqual(rollDice(seedRng("x"), 10));
  });
});
