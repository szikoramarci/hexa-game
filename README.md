# hexa-game

Utility library for a hex-grid boardgame simulator. Small, single-purpose,
pure functions — each with its own tests.

## Coordinate system

Cube coordinates: every hex is `(x, y, z)` with `x + y + z = 0`. The board
centre is `(0, 0, 0)`. Reference: [Red Blob Games — Hexagons](https://www.redblobgames.com/grids/hexagons/).

`Cube` is a plain `readonly { x, y, z }` object. Use `cube(x, y, z?)` to build one
(derives `z` and validates the constraint).

## Stack

- Strict TypeScript, ESM only, built with `tsc` → `dist/`
- Vitest for tests
- No runtime dependencies

## Scripts

| Command | Purpose |
| --- | --- |
| `npm test` | Run all tests once |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` | Emit `dist/` |

## Layout

```
src/
  coordinates.ts        Cube type, constructor, validation, vector math, directions
  coordinates.test.ts
  index.ts              public exports
```

## Adding a utility (per session)

1. One concern per file: `src/<name>.ts` + `src/<name>.test.ts`.
2. Pure functions. Take `Cube`, return new values — never mutate inputs.
3. Build on `coordinates.ts` primitives; don't re-derive them.
4. Re-export from `src/index.ts`.
5. `npm run typecheck && npm test` must pass.

### Planned utilities

- `distance` — cube distance between two hexes
- `neighbors` — adjacent hexes (via `CUBE_DIRECTIONS`)
- `range` / `ring` / `spiral` — hexes within N steps
- `line` — hexes on a straight line (with cube rounding)
- `rotate` / `reflect` — symmetry operations
- `pathfind` — A* over a passability predicate
- `layout` — cube ↔ pixel for a lightweight visual check
