import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("wrangler config", () => {
  it("ships ENVIRONMENT=production so dev-only routes stay off in deploys", () => {
    const text = readFileSync("wrangler.jsonc", "utf-8");
    expect(text).toMatch(/"ENVIRONMENT":\s*"production"/);
  });
});
