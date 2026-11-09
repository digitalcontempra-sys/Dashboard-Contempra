import { Hono, type Context } from "hono";
import type { TimeBucket } from "../../shared/rules";
import type { CardDTO } from "../../shared/types";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { claimCard, continueCard, saveCardFields, sendBackCard } from "../cards/actions";
import { board, docketHistory, getCard, listMyCards, markSeen, myCardsSummary, setSound } from "../cards/read";
import { flushCardSheet, retryCardSheet, setupProductionColumns } from "../cards/sheetSync";
import { ServiceError } from "../dockets/errors";

type Body = { fields?: unknown; version?: unknown; toStep?: unknown; reason?: unknown };

export const cardRoutes = new Hono<AppEnv>();
cardRoutes.use("/cards/*", requireAuth);

cardRoutes.onError((e, c) => {
  if (e instanceof ServiceError) return c.json({ error: e.message }, e.status);
  throw e;
});

const cardId = (c: Context<AppEnv>) => {
  const n = Number(c.req.param("id"));
  if (!Number.isInteger(n)) throw new ServiceError(404, "Card not found");
  return n;
};
const body = (c: Context<AppEnv>) => c.req.json<Body>().catch(() => ({}) as Body);

/** Returns the card and writes the sheet in the background. */
function reply(c: Context<AppEnv>, dto: CardDTO) {
  c.executionCtx.waitUntil(flushCardSheet(c.env, dto.workOrder));
  return c.json(dto);
}

const managers = requireLevel("admin", "manager");
const BUCKETS: TimeBucket[] = ["rush_today", "this_week", "coming", "no_due_date"];

cardRoutes.get("/my-cards", requireAuth, async (c) => c.json(await listMyCards(c.env, c.get("user"))));
cardRoutes.get("/my-cards/summary", requireAuth, async (c) => c.json(await myCardsSummary(c.env, c.get("user"))));

cardRoutes.put("/me/sound", requireAuth, async (c) => {
  const b = await c.req.json<{ on?: unknown }>().catch(() => ({}) as { on?: unknown });
  await setSound(c.env, c.get("user"), b.on);
  return c.json({ ok: true });
});

cardRoutes.get("/production-board", requireAuth, managers, async (c) => {
  const q = c.req.query();
  const userId = Number(q.user);
  return c.json(
    await board(c.env, c.get("user"), {
      area: q.area || undefined,
      userId: Number.isInteger(userId) && userId > 0 ? userId : undefined,
      bucket: BUCKETS.includes(q.bucket as TimeBucket) ? (q.bucket as TimeBucket) : undefined,
      wo: q.wo || undefined,
    }),
  );
});

// Registered before virtualDocketRoutes so it never falls into /virtual-dockets/:wo.
cardRoutes.get("/virtual-dockets/:wo/history", requireAuth, managers, async (c) => c.json(await docketHistory(c.env, c.req.param("wo"))));

cardRoutes.post("/admin/production-columns", requireAuth, requireLevel("admin"), async (c) => {
  const b = await c.req.json<{ confirm?: unknown }>().catch(() => ({}) as { confirm?: unknown });
  if (b.confirm !== "SET UP") return c.json({ error: "Type SET UP to confirm" }, 400);
  const out = await setupProductionColumns(c.env, c.get("user"));
  c.executionCtx.waitUntil(retryCardSheet(c.env));
  return c.json(out);
});

cardRoutes.get("/cards/:id", async (c) => c.json(await getCard(c.env, c.get("user"), cardId(c))));

cardRoutes.post("/cards/:id/seen", async (c) => {
  await markSeen(c.env, c.get("user"), cardId(c));
  return c.json({ ok: true });
});

cardRoutes.post("/cards/:id/claim", async (c) => reply(c, await claimCard(c.env, c.get("user"), cardId(c))));

cardRoutes.put("/cards/:id/fields", async (c) => {
  const b = await body(c);
  // Field edits arrive every second while someone types; the 5-minute cron writes them to the sheet,
  // which keeps Google calls well under quota. Moves (claim, continue, send back) write right away.
  return c.json(await saveCardFields(c.env, c.get("user"), cardId(c), b.fields, b.version));
});

cardRoutes.post("/cards/:id/continue", async (c) => {
  const b = await body(c);
  return reply(c, await continueCard(c.env, c.get("user"), cardId(c), b.version));
});

cardRoutes.post("/cards/:id/send-back", async (c) => {
  const b = await body(c);
  return reply(c, await sendBackCard(c.env, c.get("user"), cardId(c), b.toStep, b.reason, b.version));
});
