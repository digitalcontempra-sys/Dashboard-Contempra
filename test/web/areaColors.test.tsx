import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AreaLegend } from "../../src/web/components/AreaChip";
import { CardTile } from "../../src/web/cards/CardTile";
import { Providers } from "../../src/web/providers";
import { makeCard } from "./cardFixtures";
import { mockApi, staffUser } from "./mockApi";

afterEach(() => vi.unstubAllGlobals());

describe("area colors", () => {
  it("the legend lists the 9 areas in production order", () => {
    render(<AreaLegend />);
    const legend = screen.getByRole("region", { name: "Areas" });
    const chips = within(legend).getAllByText(/.+/, { selector: "[data-area]" });
    expect(chips).toHaveLength(9);
    expect(chips[0]).toHaveTextContent("Design");
    expect(chips[8]).toHaveTextContent("Install");
  });

  it("a card tile shows its area chip and a colored left border", () => {
    mockApi({ "GET /api/auth/me": () => staffUser });
    render(
      <MemoryRouter>
        <Providers>
          <CardTile card={makeCard({ roleId: "laminate_roll" })} onOpen={() => undefined} />
        </Providers>
      </MemoryRouter>,
    );
    const tile = screen.getByRole("button");
    const chip = within(tile).getByText("Laminate");
    expect(chip).toHaveAttribute("data-area", "laminate_roll");
    expect(tile.style.borderLeftColor).toBe("var(--area-laminate)");
  });
});
