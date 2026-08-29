import { rmSync } from "node:fs";

/**
 * Wipe `scenarios/` once before the whole test run so stale SVGs from renamed or
 * deleted scenarios never linger in the gallery. Each `*.visual.test.ts` file
 * then repopulates its own slice; `writeScenario` rebuilds `index.html` from
 * whatever `.svg` files are on disk, so the gallery aggregates every package.
 */
export default function setup(): void {
  rmSync("scenarios", { recursive: true, force: true });
}
