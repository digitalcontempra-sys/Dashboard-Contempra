import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardView } from "../../src/web/cards/CardView";
import { Providers } from "../../src/web/providers";
import { makeCard } from "./cardFixtures";
import { mockApi, staffUser } from "./mockApi";

afterEach(() => vi.unstubAllGlobals());

/** iPhone Safari: fieldsets and date inputs keep a min-content width and push the card sideways. */
describe("cards never scroll sideways", () => {
  it("the card body clips sideways and its fieldset can shrink", () => {
    mockApi({ "GET /api/auth/me": () => staffUser, "GET /api/cards/7/photos": () => ({ photos: [], folderLink: null }) });
    render(
      <MemoryRouter>
        <Providers>
          <CardView card={makeCard({ roleId: "installer", nextRoleId: null })} onClose={() => undefined} />
        </Providers>
      </MemoryRouter>,
    );
    const fieldset = screen.getByLabelText("Date").closest("fieldset")!;
    expect(fieldset.className).toContain("min-w-0");
    const body = fieldset.closest(".overflow-y-auto")!;
    expect(body.className).toContain("overflow-x-hidden");
  });

  it("date inputs shrink to their field on iOS", () => {
    const css = readFileSync(resolve(process.cwd(), "src/web/index.css"), "utf-8");
    expect(css).toMatch(/input\[type="date"\][^{]*\{[^}]*min-width:\s*0[^}]*-webkit-appearance:\s*none/);
  });
});
