import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardTile } from "../../src/web/cards/CardTile";
import { DocketList } from "../../src/web/components/DocketList";
import { Providers } from "../../src/web/providers";
import { TaskTile } from "../../src/web/tasks/TaskCards";
import { makeCard } from "./cardFixtures";
import { mockApi, staffUser } from "./mockApi";

afterEach(() => vi.unstubAllGlobals());

const wrap = (node: React.ReactNode) => (
  <MemoryRouter>
    <Providers>{node}</Providers>
  </MemoryRouter>
);

describe("cards stay white in dark mode", () => {
  it("light tokens also apply inside .force-light, and the dark override only targets :root", () => {
    const css = readFileSync(resolve(process.cwd(), "src/web/index.css"), "utf-8");
    // Semantic light tokens and the light area tokens are scoped to `:root, .force-light`.
    expect(css.match(/^:root,\s*\.force-light\s*\{/gm)?.length).toBeGreaterThanOrEqual(2);
    // A white, readable tile whatever the OS theme.
    expect(css).toMatch(/\.force-light\.tile[^{]*\{[^}]*background:\s*rgb\(255 255 255\)/);
  });

  it("docket cards, task cards and dashboard tiles use the light scope", () => {
    mockApi({ "GET /api/auth/me": () => staffUser });
    render(
      wrap(
        <>
          <CardTile card={makeCard()} onOpen={() => undefined} />
          <TaskTile
            task={{
              id: 1,
              from: { id: 9, name: "Seb" },
              to: { id: 2, name: "Ana" },
              note: "n",
              due: { kind: "none" },
              bucket: "no_due_date",
              status: "open",
              createdAt: "2026-11-10T15:00:00Z",
              doneAt: null,
              isNew: false,
            }}
            onOpen={() => undefined}
          />
          <DocketList
            items={[
              {
                workOrder: "1",
                customer: "Co",
                project: null,
                accountManager: null,
                dateIso: null,
                dueIso: null,
                dueRaw: null,
                status: "active",
                billing: "not_billed",
                bucket: "no_due_date",
                overdue: false,
              },
            ]}
            onOpen={() => undefined}
          />
        </>,
      ),
    );
    const tiles = screen.getAllByRole("button");
    expect(tiles).toHaveLength(3);
    for (const t of tiles) expect(t.className).toContain("force-light");
    expect(tiles[0].className).toContain("border-l-[6px]");
  });
});
