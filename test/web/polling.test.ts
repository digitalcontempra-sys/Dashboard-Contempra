import { afterEach, describe, expect, it, vi } from "vitest";
import { alertsInterval, HIDDEN_POLL_MS, POLL_MS } from "../../src/web/cards/useCardAlerts";
import { docketListInterval } from "../../src/web/pages/Dashboard";

vi.mock("../../src/web/cards/chime", () => ({
  armChime: vi.fn(),
  isAudioReady: () => false,
  onAudioReady: () => () => {},
  playChime: vi.fn(),
}));

const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });

afterEach(() => setHidden(false));

describe("polling (D1 rows read)", () => {
  it("alerts poll every 20 s on screen, every 60 s in a hidden tab (the title still announces new cards)", () => {
    setHidden(false);
    expect(alertsInterval()).toBe(POLL_MS);
    setHidden(true);
    expect(alertsInterval()).toBe(HIDDEN_POLL_MS);
    expect(HIDDEN_POLL_MS).toBe(60_000);
  });

  it("the docket list refreshes every 30 s, History every 5 min", () => {
    expect(docketListInterval("active")).toBe(30_000);
    expect(docketListInterval("on_hold")).toBe(30_000);
    expect(docketListInterval("history")).toBe(300_000);
  });
});
