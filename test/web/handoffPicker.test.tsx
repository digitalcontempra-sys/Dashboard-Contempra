import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { emptyRow, HandoffPicker, rowsComplete, toTargets, type HandoffRow } from "../../src/web/cards/HandoffPicker";

const people = [
  { id: 1, fullName: "Ira Doe", roles: ["designer", "printer_roll"] },
  { id: 2, fullName: "Kristy", roles: [] },
];

function Harness({ onRows }: { onRows: (r: HandoffRow[]) => void }) {
  const [rows, setRows] = useState<HandoffRow[]>([emptyRow()]);
  return (
    <HandoffPicker
      people={people}
      rows={rows}
      onChange={(r) => {
        setRows(r);
        onRows(r);
      }}
    />
  );
}

describe("HandoffPicker", () => {
  it("lists people by area, a person in each of their areas, and people without one under Other", () => {
    render(<Harness onRows={() => undefined} />);
    const select = screen.getByRole("combobox", { name: "Person 1" });
    const groups = [...select.querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)]);
    expect(groups).toEqual([
      ["Design", ["Ira Doe — Design"]],
      ["Print Roll", ["Ira Doe — Print Roll"]],
      ["Other", ["Kristy"]],
    ]);
  });

  it("builds one target per person, with the area and what to do", async () => {
    let rows: HandoffRow[] = [];
    render(<Harness onRows={(r) => (rows = r)} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Person 1" }), "1:printer_roll");
    // What to do is optional: a person is enough.
    expect(rowsComplete(rows)).toBe(true);
    expect(toTargets(rows)).toEqual([{ userId: 1, roleId: "printer_roll", instruction: "" }]);
    await userEvent.type(screen.getByRole("textbox", { name: "What to do 1" }), "Print 2 banners");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Person 2" }), "2:general");
    await userEvent.type(screen.getByRole("textbox", { name: "What to do 2" }), "Call client");
    expect(rowsComplete(rows)).toBe(true);
    expect(toTargets(rows)).toEqual([
      { userId: 1, roleId: "printer_roll", instruction: "Print 2 banners" },
      { userId: 2, roleId: "general", instruction: "Call client" },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove person 1" }));
    expect(within(document.body).getAllByRole("combobox")).toHaveLength(1);
  });
});

describe("HandoffPicker: teams and Sub Contract", () => {
  const crew = [
    { id: 3, fullName: "Gary", roles: ["installer"] },
    { id: 4, fullName: "Dennis", roles: ["installer"] },
    { id: 5, fullName: "Ali", roles: ["subcontract"] },
  ];
  const teams = [{ id: 7, name: "Team B", roleId: "installer", members: [{ id: 4, fullName: "Dennis" }, { id: 3, fullName: "Gary" }] }];
  function TeamHarness({ canSubcontract, onRows }: { canSubcontract: boolean; onRows: (r: HandoffRow[]) => void }) {
    const [rows, setRows] = useState<HandoffRow[]>([emptyRow()]);
    return (
      <HandoffPicker
        people={crew}
        teams={teams}
        canSubcontract={canSubcontract}
        rows={rows}
        onChange={(r) => {
          setRows(r);
          onRows(r);
        }}
      />
    );
  }
  const groupsOf = () =>
    [...screen.getByRole("combobox", { name: "Person 1" }).querySelectorAll("optgroup")].map((g) => [
      g.label,
      [...g.querySelectorAll("option")].map((o) => o.textContent),
    ]);

  it("lists teams first, and Sub Contract only for managers", () => {
    const { unmount } = render(<TeamHarness canSubcontract onRows={() => undefined} />);
    expect(groupsOf()).toEqual([
      ["Teams", ["Team B — Install (Dennis, Gary)"]],
      ["Install", ["Gary — Install", "Dennis — Install"]],
      ["Sub Contract", ["Ali — Sub Contract"]],
      // Sub Contract is not their own area: they can still get a General card.
      ["Other", ["Ali"]],
    ]);
    unmount();
    render(<TeamHarness canSubcontract={false} onRows={() => undefined} />);
    expect(groupsOf().map((g) => g[0])).toEqual(["Teams", "Install", "Other"]);
  });

  it("a team row becomes one team target", async () => {
    let rows: HandoffRow[] = [];
    render(<TeamHarness canSubcontract={false} onRows={(r) => (rows = r)} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Person 1" }), "team:7");
    await userEvent.type(screen.getByRole("textbox", { name: "What to do 1" }), "Install sign");
    expect(rowsComplete(rows)).toBe(true);
    expect(toTargets(rows)).toEqual([{ teamId: 7, instruction: "Install sign" }]);
  });
});
