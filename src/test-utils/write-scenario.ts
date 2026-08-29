import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "vitest";
import { renderScenario, type RenderOptions } from "./render-scenario.js";
import type { Scenario } from "./scenario.js";

const OUT_DIR = "scenarios";

/** True once this worker has written at least one scenario. */
let wroteSomething = false;

/**
 * Render `s` and drop it at `scenarios/<name>.svg`, returning the SVG string.
 * The `scenarios/` directory is gitignored; writing a few small SVGs costs
 * milliseconds, so there is no env gating.
 */
export function writeScenario(
  name: string,
  s: Scenario,
  opts?: RenderOptions,
): string {
  const svg = renderScenario(s, opts);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.svg`), svg);
  wroteSomething = true;
  writeIndex();
  return svg;
}

/**
 * A flex-wrap gallery of every `.svg` currently in `scenarios/`. Built from the
 * directory rather than in-memory state so it aggregates across every
 * `*.visual.test.ts` package, each of which runs in its own vitest worker.
 */
function writeIndex(): void {
  const names = readdirSync(OUT_DIR)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => file.slice(0, -".svg".length))
    .sort();

  // `<utility>-<case>` -> one section per utility package.
  const packages = new Map<string, string[]>();
  for (const name of names) {
    const dash = name.indexOf("-");
    const pkg = dash === -1 ? "misc" : name.slice(0, dash);
    let entries = packages.get(pkg);
    if (!entries) {
      entries = [];
      packages.set(pkg, entries);
    }
    entries.push(name);
  }

  const sections = [...packages]
    .map(([pkg, entries]) => {
      const figures = entries
        .map(
          (name) =>
            `      <figure>\n` +
            `        <figcaption>${name}</figcaption>\n` +
            `        <img src="${name}.svg" alt="${name}" />\n` +
            `      </figure>`,
        )
        .join("\n");
      return (
        `    <section>\n` +
        `      <h2>${pkg}</h2>\n` +
        `      <div class="gallery">\n${figures}\n      </div>\n` +
        `    </section>`
      );
    })
    .join("\n");

  const html =
    `<!doctype html>\n` +
    `<html lang="en">\n<head>\n<meta charset="utf-8" />\n` +
    `<title>hexa-game visual scenarios</title>\n` +
    `<style>\n` +
    `  body { font-family: sans-serif; margin: 1rem; }\n` +
    `  h2 { margin: 1.5rem 0 .5rem; text-transform: capitalize; }\n` +
    `  .gallery { display: flex; flex-wrap: wrap; gap: 1rem; }\n` +
    `  figure { margin: 0; border: 1px solid #ddd; padding: .5rem; }\n` +
    `  figcaption { font-size: .85rem; color: #555; margin-bottom: .25rem; }\n` +
    `  img { display: block; width: 320px; height: auto; }\n` +
    `</style>\n</head>\n<body>\n` +
    `  <h1>Visual scenarios</h1>\n` +
    `${sections}\n` +
    `</body>\n</html>\n`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "index.html"), html);
}

// Rewrite the gallery once more after this file's tests settle. Idempotent.
afterAll(() => {
  if (wroteSomething) writeIndex();
});
