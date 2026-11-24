import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CardDTO, TeamDTO } from "../../src/shared/types";
import { flushCardSheet, STAGE_HEADERS, TRACKING_TAB } from "../../src/worker/cards/sheetSync";
import { allCards, cardOf, errorOf, handDocket, move, post, put, setupCards, teardownCards } from "./cardHelpers";
import { api } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
let gary: string;
let dennis: string;
let team: TeamDTO;

beforeEach(async () => {
  s = await setupCards();
  gary = await s.staffWith("gary", "installer", "measure");
  dennis = await s.staffWith("dennis", "installer");
  const res = await post("/api/teams", s.admin, { name: "Team B", memberIds: [s.ids.gary, s.ids.dennis] });
  expect(res.status).toBe(200);
  team = (await res.json()) as TeamDTO;
});
afterEach(teardownCards);

const myCards = async (cookie: string) => (await (await api("/api/my-cards", { cookie })).json()) as CardDTO[];
const toTeam = (instruction = "Install the sign") => [{ teamId: team.id, instruction }];

describe("Teams (Admin)", () => {
  it("an admin creates, edits and deletes teams; everyone can list them", async () => {
    expect(team).toMatchObject({ name: "Team B", roleId: "installer", members: [{ id: s.ids.dennis, fullName: "dennis" }, { id: s.ids.gary, fullName: "gary" }] });
    const list = (await (await api("/api/teams", { cookie: gary })).json()) as TeamDTO[];
    expect(list.map((t) => t.name)).toEqual(["Team B"]);

    const edit = await put(`/api/teams/${team.id}`, s.admin, { name: "Crew B", memberIds: [s.ids.gary] });
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as TeamDTO).members.map((m) => m.id)).toEqual([s.ids.gary]);

    expect((await api(`/api/teams/${team.id}`, { method: "DELETE", cookie: s.admin })).status).toBe(200);
    expect(await (await api("/api/teams", { cookie: gary })).json()).toEqual([]);
  });

  it("only admins can change teams", async () => {
    expect((await post("/api/teams", s.manager, { name: "Team C", memberIds: [s.ids.gary] })).status).toBe(403);
    expect((await put(`/api/teams/${team.id}`, gary, { name: "X", memberIds: [s.ids.gary] })).status).toBe(403);
    expect((await api(`/api/teams/${team.id}`, { method: "DELETE", cookie: s.manager })).status).toBe(403);
  });

  it("needs a unique name and installers as members", async () => {
    await s.staffWith("ira", "designer");
    const bad = async (body: unknown, status: number, error: string) => {
      const res = await post("/api/teams", s.admin, body);
      expect(res.status).toBe(status);
      expect(await errorOf(res)).toBe(error);
    };
    await bad({ name: " ", memberIds: [s.ids.gary] }, 400, "Enter a team name.");
    await bad({ name: "Team C", memberIds: [] }, 400, "Choose at least one member.");
    await bad({ name: "Team C", memberIds: [s.ids.ira] }, 400, "Only installers can be in a team.");
    await bad({ name: "team b", memberIds: [s.ids.gary] }, 409, "A team with that name already exists.");
  });
});

describe("sending a docket to a team", () => {
  it("creates one Installer card for every member, labelled with the team", async () => {
    const d = await handDocket(s.manager, toTeam() as never);
    const cards = await allCards(d.workOrder);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ role_id: "installer", status: "active", instruction: "Install the sign" });
    expect(JSON.parse(cards[0].assignee_ids)).toEqual([s.ids.gary, s.ids.dennis]);
    for (const cookie of [gary, dennis]) {
      const [c] = await myCards(cookie);
      expect(c).toMatchObject({ workOrder: d.workOrder, teamName: "Team B", isNew: true });
    }
  });

  it("the first to start it takes it; the other member can no longer move it", async () => {
    const d = await handDocket(s.manager, toTeam() as never);
    const c = await cardOf(d.workOrder, s.ids.gary);
    expect((await post(`/api/cards/${c.id}/claim`, gary)).status).toBe(200);
    const again = await post(`/api/cards/${c.id}/claim`, dennis);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("gary is already on it.");
    await put(`/api/cards/${c.id}/fields`, gary, { fields: { installed: true }, version: c.version });
    const fresh = await cardOf(d.workOrder, s.ids.gary);
    const taken = await move(fresh, "done", dennis);
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe("gary is already on it.");
    // Still shown to Dennis, with who has it.
    expect((await myCards(dennis))[0].claimedBy?.name).toBe("gary");
    expect((await move(fresh, "done", gary)).status).toBe(200);
    expect(await myCards(gary)).toEqual([]);
    expect(await myCards(dennis)).toEqual([]);
  });

  it("can be sent to a team on Continue, and comes back to the same parked card", async () => {
    const ira = await s.staffWith("ira", "designer");
    const d = await handDocket(s.manager, [{ userId: s.ids.ira, instruction: "Logo" }]);
    const design = await cardOf(d.workOrder, s.ids.ira);
    expect((await move(design, "continue", ira, { to: toTeam("Install") })).status).toBe(200);
    const inst = await cardOf(d.workOrder, s.ids.dennis);
    expect((await move(inst, "send-back", dennis, { reason: "Wrong size" })).status).toBe(200);
    const back = await cardOf(d.workOrder, s.ids.ira);
    await move(back, "continue", ira, { to: toTeam("Install v2") });
    const cards = (await allCards(d.workOrder)).filter((c) => c.role_id === "installer");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: inst.id, status: "active", instruction: "Install v2" });
  });

  it("rejects an unknown or empty team", async () => {
    const res = await api("/api/virtual-dockets", { method: "POST", cookie: s.manager, json: { form: (await import("./cardHelpers")).docketForm(), handoff: [{ teamId: 9999, instruction: "" }] } });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Choose at least one person.");
  });

  it("shows the team in the sheet's ROLE and Assigned until someone starts it, and in Docket Tracking", async () => {
    await post("/api/admin/production-columns", s.admin, { confirm: "SET UP" });
    const d = await handDocket(s.manager, toTeam() as never);
    await flushCardSheet(env, d.workOrder);
    const raw = s.g.sheet.rowOf(d.workOrder)!;
    const row = s.g.sheet.rows[0][11] === "STATUS" ? [...raw.slice(0, 11), ...raw.slice(12)] : raw;
    expect(row[10]).toBe("Team B");
    expect(row[16 + STAGE_HEADERS.indexOf("Assigned")]).toBe("Team B");
    expect(row[16 + STAGE_HEADERS.indexOf("Install")]).toBe("Active · Team B");
    const tracking = String(s.g.sheet.tabs[TRACKING_TAB].find((x) => String(x[0]) === d.workOrder)![2]);
    expect(tracking).toMatch(/^mgr - created - /);
    expect(tracking).toMatch(/\nTeam B - received from mgr - /);
  });
});

describe("Sub Contract", () => {
  it("only an admin or manager can send work to Sub Contract", async () => {
    const boss = s.ids.boss;
    await env.DB.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, 'subcontract')").bind(boss).run();
    const ira = await s.staffWith("ira", "designer");
    const d = await handDocket(s.manager, [{ userId: s.ids.ira, instruction: "Logo" }]);
    const c = await cardOf(d.workOrder, s.ids.ira);
    const res = await move(c, "continue", ira, { to: [{ userId: boss, roleId: "subcontract", instruction: "Letters" }] });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("Only a manager can send work to Sub Contract.");
    expect((await handDocket(s.manager, [{ userId: boss, roleId: "subcontract", instruction: "Letters" }])).workOrder).toBeTruthy();
  });
});
