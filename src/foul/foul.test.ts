import { describe, expect, it } from "vitest";
import { rollDie, seedRng } from "../dice/dice.js";
import { pacePenalty, resolveFoul, tackleFoul } from "./foul.js";

/** First seed whose (injury d6, card d6) pair satisfies `pred`. */
function seedFor(pred: (injury: number, card: number) => boolean): number {
  for (let s = 1; s < 200_000; s++) {
    const [injury, r1] = rollDie(seedRng(s), 6);
    const [card] = rollDie(r1, 6);
    if (pred(injury, card)) return s;
  }
  throw new Error("no seed matches");
}

describe("tackleFoul", () => {
  it("is a defender roll of exactly 1", () => {
    expect(tackleFoul(1)).toBe(true);
    expect(tackleFoul(2)).toBe(false);
    expect(tackleFoul(6)).toBe(false);
  });
});

describe("resolveFoul", () => {
  it("rolls injury first, then the card, advancing rng by two draws", () => {
    const rng = seedRng(42);
    const [injury, r1] = rollDie(rng);
    const [card, r2] = rollDie(r1);
    const r = resolveFoul(rng, 4, 0, 4);
    expect([r.injuryRoll, r.cardRoll]).toEqual([injury, card]);
    expect(r.rng).toBe(r2);
  });

  it("injures on a roll at or above resilience, not below", () => {
    const seed = seedFor((injury) => injury === 4);
    expect(resolveFoul(seedRng(seed), 4, 0, 7).injured).toBe(true);
    expect(resolveFoul(seedRng(seed), 5, 0, 7).injured).toBe(false);
  });

  it("books on a card roll at or above leniency, not below", () => {
    const seed = seedFor((_i, card) => card === 4);
    expect(resolveFoul(seedRng(seed), 7, 0, 4).booked).toBe(true);
    expect(resolveFoul(seedRng(seed), 7, 0, 5).booked).toBe(false);
  });

  it("leaves the yellow count alone when not booked", () => {
    const seed = seedFor((_i, card) => card === 3);
    const r = resolveFoul(seedRng(seed), 7, 1, 6); // card 3 < leniency 6
    expect(r.booked).toBe(false);
    expect(r.yellows).toBe(1);
    expect(r.sentOff).toBe(false);
  });

  it("a first booking is a yellow, a second is a red", () => {
    const seed = seedFor((_i, card) => card >= 4);
    const first = resolveFoul(seedRng(seed), 7, 0, 4);
    expect(first).toMatchObject({ booked: true, yellows: 1, sentOff: false });
    const second = resolveFoul(seedRng(seed), 7, 1, 4);
    expect(second).toMatchObject({ booked: true, yellows: 2, sentOff: true });
  });

  it("replays identically from a fixed seed", () => {
    expect(resolveFoul(seedRng(7), 4, 1, 4)).toEqual(resolveFoul(seedRng(7), 4, 1, 4));
  });
});

describe("pacePenalty", () => {
  it("is 2 for an injured piece, 0 otherwise", () => {
    expect(pacePenalty({ injured: true })).toBe(2);
    expect(pacePenalty({ injured: false })).toBe(0);
    expect(pacePenalty({})).toBe(0);
  });
});
