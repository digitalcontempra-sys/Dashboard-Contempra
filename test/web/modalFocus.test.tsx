import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../../src/web/providers";
import { NewTaskCardButton } from "../../src/web/tasks/NewTaskCard";
import { TaskView } from "../../src/web/tasks/TaskCards";
import { mockApi, staffUser } from "./mockApi";

afterEach(() => vi.unstubAllGlobals());

const wrap = (node: React.ReactNode) => (
  <MemoryRouter>
    <Providers>{node}</Providers>
  </MemoryRouter>
);

describe("modals keep focus when the page refreshes behind them", () => {
  it("New Task Card: typing a note is not interrupted by a parent re-render", async () => {
    mockApi({ "GET /api/auth/me": () => staffUser, "GET /api/assignees": () => [] });
    const { rerender } = render(wrap(<NewTaskCardButton key="b" />));
    await userEvent.click(screen.getByRole("button", { name: "New Task Card" }));
    const note = screen.getByLabelText("Note");
    await userEvent.click(note);
    expect(document.activeElement).toBe(note);
    rerender(wrap(<NewTaskCardButton key="b" className="btn-ghost " />));
    expect(document.activeElement).toBe(note);
  });

  it("Task view: a parent re-render does not mark the task seen again", async () => {
    const { calls } = mockApi({ "GET /api/auth/me": () => staffUser, "POST /api/task-cards/3/seen": () => ({ ok: true }) });
    const task = {
      id: 3,
      from: { id: 9, name: "Seb Bastian" },
      to: { id: 2, name: "Ana Lopez" },
      note: "Call the vendor",
      due: { kind: "none" as const },
      bucket: "no_due_date" as const,
      status: "open" as const,
      createdAt: "2026-11-10T15:00:00Z",
      doneAt: null,
      isNew: true,
    };
    const { rerender } = render(wrap(<TaskView task={task} onClose={() => undefined} />));
    await waitFor(() => expect(calls.filter((c) => c.url.pathname === "/api/task-cards/3/seen")).toHaveLength(1));
    rerender(wrap(<TaskView task={task} onClose={() => undefined} />));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.filter((c) => c.url.pathname === "/api/task-cards/3/seen")).toHaveLength(1);
  });
});
