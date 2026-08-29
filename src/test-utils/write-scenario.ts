import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "vitest";
import {
  refreshLanding,
  registerUtilityGroup,
  SCENARIOS_DIR,
} from "./gallery.js";
import { renderScenario, type RenderOptions } from "./render-scenario.js";
import type { Scenario } from "./scenario.js";

/** True once this worker has written at least one scenario. */
let wroteSomething = false;

/**
 * Render `s` and drop it at `scenarios/utilities/<group>/<name>.svg`, returning
 * the SVG string, then rebuild that group's page and the landing nav. The
 * `scenarios/` directory is gitignored; a few small SVGs cost milliseconds, so
 * there is no env gating.
 *
 * @param group  Utility slug — its folder and landing-page card (e.g. `"arrow"`).
 * @param name   Case name within the group (e.g. `"styles"`).
 */
export function writeScenario(
  group: string,
  name: string,
  s: Scenario,
  opts?: RenderOptions,
): string {
  const svg = renderScenario(s, opts);
  const dir = join(SCENARIOS_DIR, "utilities", group);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.svg`), svg);
  wroteSomething = true;
  registerUtilityGroup(group);
  return svg;
}

// Refresh the landing page once more after this file's tests settle, in case a
// sibling worker rebuilt it in between. Idempotent.
afterAll(() => {
  if (wroteSomething) refreshLanding();
});
