import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AREA_TOKEN, ROLE_ORDER } from "../../src/shared/cards";

/** The area chip is ink text on a tint of the area color; spec §2 asks for AA (4.5:1). */
const css = readFileSync(resolve(process.cwd(), "src/web/index.css"), "utf-8");
const section = css.slice(css.indexOf("Production areas"));
const light = section.slice(0, section.indexOf("@media"));
const dark = section.slice(section.indexOf("@media"), section.indexOf("Layer 3"));

function rgb(block: string, name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+)\\)`).exec(block);
  if (!m) throw new Error(`missing --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const alpha = (block: string) => Number(/--area-soft-alpha:\s*([\d.]+)/.exec(block)![1]);
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (fg: readonly number[], bg: readonly number[], a: number) => fg.map((v, i) => v * a + bg[i] * (1 - a));

describe("area chip contrast", () => {
  for (const [mode, block, page] of [
    ["light", light, [255, 255, 255]],
    ["dark", dark, [13, 15, 20]],
  ] as const) {
    it(`meets AA in ${mode} mode for every area`, () => {
      for (const role of ROLE_ORDER) {
        const token = AREA_TOKEN[role];
        const tint = mix(rgb(block, token), page, alpha(block));
        const r = ratio(rgb(block, `${token}-ink`), tint);
        expect(r, `${role} ${mode} ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
