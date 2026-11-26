import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Active segments are solid pills; their text must reach AA (4.5:1) in both themes. */
const css = readFileSync(resolve(process.cwd(), "src/web/index.css"), "utf-8");
const section = css.slice(css.indexOf("Segmented control"));
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

describe("segmented control contrast", () => {
  for (const [mode, block, page] of [
    ["light", light, [246, 247, 251]],
    ["dark", dark, [13, 15, 20]],
  ] as const) {
    it(`active pills meet AA in ${mode} mode`, () => {
      for (const tone of ["brand", "ink"]) {
        const r = ratio(rgb(block, `seg-${tone}-ink`), rgb(block, `seg-${tone}-bg`));
        expect(r, `${tone} ${mode} ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`idle text meets AA on the page in ${mode} mode`, () => {
      const r = ratio(rgb(block, "seg-idle"), page);
      expect(r, `idle ${mode} ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("uses the brand red for the brand tone in both themes", () => {
    expect(rgb(light, "seg-brand-bg")).toEqual([204, 20, 40]);
    expect(rgb(dark, "seg-brand-bg")).toEqual([204, 20, 40]);
  });
});
