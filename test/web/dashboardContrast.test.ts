import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Personal cards (Main Dashboard header): every text ink must reach AA (4.5:1) on both veil stops, in both themes. */
const css = readFileSync(resolve(process.cwd(), "src/web/index.css"), "utf-8");
const section = css.slice(css.indexOf("Personal card veils"));
const light = section.slice(0, section.indexOf("@media"));
const dark = section.slice(section.indexOf("@media"), section.indexOf("/* ----------", 10));

function rgb(block: string, name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+)\\)`).exec(block);
  if (!m) throw new Error(`missing --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const lum = (c: readonly number[]) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: readonly number[], b: readonly number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("personal card veils contrast", () => {
  for (const [mode, block] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const hue of ["amber", "red", "blue"]) {
      it(`${hue} inks meet AA on the ${hue} veil in ${mode} mode`, () => {
        for (const ink of ["title", "num", "detail"]) {
          for (const stop of ["from", "to"]) {
            const r = ratio(rgb(block, `veil-${hue}-${ink}`), rgb(block, `veil-${hue}-${stop}`));
            expect(r, `${hue} ${ink} on ${stop} (${mode}) ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }
});
