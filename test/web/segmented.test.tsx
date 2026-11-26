import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "../../src/web/components/Segmented";

const items = [
  { id: "all", label: "All dockets", icon: "layers" as const },
  { id: "mine", label: "My Dockets", icon: "user" as const, count: 4 },
];

describe("Segmented", () => {
  it("marks only the active segment as selected and shows its tone", () => {
    render(<Segmented label="Whose dockets" tone="brand" items={items} value="mine" onChange={() => {}} />);
    const list = screen.getByRole("tablist", { name: "Whose dockets" });
    expect(list).toHaveAttribute("data-tone", "brand");
    const mine = screen.getByRole("tab", { name: /My Dockets/ });
    const all = screen.getByRole("tab", { name: /All dockets/ });
    expect(mine).toHaveAttribute("aria-selected", "true");
    expect(all).toHaveAttribute("aria-selected", "false");
    expect(mine.className).toContain("seg");
    expect(mine.querySelector("svg")).not.toBeNull();
    expect(mine).toHaveTextContent("4");
  });

  it("lets only the active segment be tabbed to and moves with arrow keys", () => {
    const onChange = vi.fn();
    render(<Segmented label="View" items={items} value="all" onChange={onChange} />);
    const all = screen.getByRole("tab", { name: /All dockets/ });
    expect(all).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /My Dockets/ })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(all, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("mine");
    fireEvent.click(screen.getByRole("tab", { name: /My Dockets/ }));
    expect(onChange).toHaveBeenLastCalledWith("mine");
  });

  it("defaults to the ink tone", () => {
    render(<Segmented label="View" items={items} value="all" onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toHaveAttribute("data-tone", "ink");
  });
});
