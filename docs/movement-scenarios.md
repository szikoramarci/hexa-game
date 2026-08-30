# Session spec: movement scenarios — grouped + seeded

Goal: the `actions/movement` playground page has grown to 13 cases in one flat
wall. Split it into four labelled sections and give the dice cases **curated
seed chips** so every possible event (steal / no-steal, tackle won / lost /
foul / loose ball) is one click away — no more hammering `reset` to catch a tie.

Pure page/generator change: `src/test-utils/movement-playground.ts` + its inline
script + `src/movement/movement.playground.test.ts`. No `move-action` logic
touched.

## 1. Sections

`MovementCase` gains `group`; the page renders one `<section class="group">`
per group (heading + its own `.cases` flex row), in this order:

| group | heading | cases |
| --- | --- | --- |
| `movement` | Simple movement | open field ×2, one pillar, walled + gap, S-corridor, two pieces |
| `steal` | Ball steal | carry past a defender, run the gauntlet |
| `tackle` | Tackling | close down the carrier, just out of reach, rides the challenge, shoulder to shoulder |
| `loose-ball` | Loose ball | loose ball in a crowd |

- Case `id`s stay the global `case-<i>` (seeds, tests, cross-checks unchanged).
- Top of page: a one-line jump nav — `Simple movement · Ball steal · Tackling ·
  Loose ball` linking `#group-<key>`.
- Empty groups are skipped.

```ts
export type MovementGroup = "movement" | "steal" | "tackle" | "loose-ball";

export interface MovementCase {
  title: string;
  group: MovementGroup;
  play: MovementPlayground;
  /** Dice outcomes to surface as one-click seed chips. Resolved by the test
      (see §2) before the page is written; omit for deterministic cases. */
  outcomes?: MovementOutcome[];
}
```

## 2. Seed chips

Today: `seed = seedRng("case-<i>")`, one fixed roll; `reset` throws a
`Math.random` seed. To see a tackle tie you reset ~10× and hope.

New: each dice case carries a short **ordered, labelled seed list**, one seed per
notable outcome. The playground shows them as a chip row; clicking a chip
restores the board, sets `rng` to that seed, and **auto-plays the case's probe**
so the event happens immediately and the `.log` line narrates it.

### Outcomes

| group | outcomes | classify terminal snapshot |
| --- | --- | --- |
| `steal` | `safe`, `steal` | `snap.steal ? "steal" : "safe"` |
| `tackle` | `tackle-won`, `tackle-lost`, `foul`, `loose-ball` | `foul` phase → `foul`; `looseBall` phase → `loose-ball`; else `outcome.winner === "defender" ? "tackle-won" : "tackle-lost"` |
| `loose-ball` | `lb-caught`, `lb-clear` | `looseBall` + `scatter.caughtBy` → `lb-caught`, else `lb-clear` |

Chip labels are plain: *safe run*, *ball stolen*, *tackle won*, *tackle lost*,
*foul*, *loose ball*, *loose ball · caught*, *loose ball · rolls clear*.
"just out of reach" has no probe → no chips (plain `reset` only).

### Resolving seeds (test-side)

`movement.playground.test.ts` owns a `probe` per dice case (the canonical event
script) and the wanted `outcomes`. A helper scans seeds and bakes the first hit:

```ts
// smallest seed in [0, LIMIT) whose probe play lands in each wanted outcome
function resolveSeeds(c: MovementCase): { label: string; seed: number }[]
```

- `LIMIT = 4096`. Throws `outcome "<x>" not found for "<title>" in <LIMIT> seeds`
  if an authored outcome never appears — keeps the chip list honest and catches
  a case setup that can't actually produce it.
- Runs the **real** `initMoveAction` / `moveAction` reducer, so the chips are
  guaranteed reproducible on the page (inline mirror is already cross-checked).
- Result is passed to `writeMovementPlayground` on the case as
  `seeds: {label, seed}[]`; `outcomes` itself is not needed by the generator.

### Probes

| group | probe events |
| --- | --- |
| `steal` | `selectPiece p0`, `commit <hex past the defender>`, then `advance` to the end |
| `tackle` / `loose-ball` | `selectPiece p0` (the defender), `tackle`, `advance` to the challenge |

Probe stops at the first terminal / `relocating` phase — the chip demos the
*result*, not the repositioning. Baked into `DATA.probe` as
`{t, id?, hex?}[]` (hex as a cube key); `advance` steps are driven by the
existing `runWalk` loop.

## 3. Playground script

- `DATA.seeds: {label, seed}[]`, `DATA.probe: Ev[]` added to `CaseData`.
- `DATA.seed` (initial) = `seeds[0].seed` when present, else `seedRng(caseId)`.
- HUD row: `<span class="chips">` of `<button class="chip" data-seed>` before the
  existing `reset`. `reset` keeps its meaning (restore positions, keep seed);
  add a `shuffle` button for the old random-seed behaviour.
- Chip click → `resetPositions()`, `rng = seed`, replay `DATA.probe`
  (`selectPiece`/`commit`/`tackle` via `dispatch`, then `runWalk`), `render()`.
- Active chip gets `.chip.on`. No `${`/backtick in the script string (as now).

## 4. Tests — `movement.playground.test.ts`

Keep the existing checks; adjust/add:

- every group heading + jump-nav anchor is on the page; each case sits under its
  group section.
- `resolveSeeds` returns one seed per authored outcome; each baked seed, replayed
  through the real reducer, reproduces its labelled outcome (round-trip).
- the loose-ball crowd case yields **both** `lb-caught` and `lb-clear` seeds
  within `LIMIT`.
- `DATA.seed` matches `seeds[0].seed` for dice cases, `seedRng(caseId)` for the
  plain ones (replaces the current "baked seed is seedRng(caseId)" test).
- chips render: `class="chip"`, `data-seed`, one per resolved entry; `shuffle`
  button present.
- deterministic-play tests (gauntlet, tackle cases) now seed from the resolved
  chip seed instead of `seedRng("case-<i>")`.

## 5. Docs

- README "Visual scenarios" — note the four sections and the seed chips.
- `docs/movement-playground.md` — cross-link this spec.
- Aside (not this session): `docs/move-action.md` could move its "Ball steal"
  section below "Scope" for the same top-down flow.

## Done when

- [x] `npm run typecheck && npm test` pass (239 tests).
- [x] `scenarios/actions/movement` shows four titled sections with a jump nav;
  dice cases show seed chips that each land their labelled event on click;
  the loose-ball case reaches a tie in one click.
- [x] README + `docs/movement-playground.md` updated.

Deviations from the draft: case headings became `<h3>` (group heading is now the
`<h2>`); `shuffle` renders only on cases with a ball; `outcomes` entries accept a
list of classes so one "loose ball" chip can match `lb-caught`/`lb-clear`.
