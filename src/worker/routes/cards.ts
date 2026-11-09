import { Hono, type Context } from "hono";
import type { CardDTO } from "../../shared/types";
import type { AppEnv } from "../app";
import { requireAuth } from "../auth/sessions";
import { claimCard, continueCard, saveCardFields, sendBackCard } from "../cards/actions";
import { flushCardSheet } from "../cards/sheetSync";
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

cardRoutes.post("/cards/:id/claim", async (c) => reply(c, await claimCard(c.env, c.get("user"), cardId(c))));

cardRoutes.put("/cards/:id/fields", async (c) => {
  const b = await body(c);
  return reply(c, await saveCardFields(c.env, c.get("user"), cardId(c), b.fields, b.version));
});

cardRoutes.post("/cards/:id/continue", async (c) => {
  const b = await body(c);
  return reply(c, await continueCard(c.env, c.get("user"), cardId(c), b.version));
});

cardRoutes.post("/cards/:id/send-back", async (c) => {
  const b = await body(c);
  return reply(c, await sendBackCard(c.env, c.get("user"), cardId(c), b.toStep, b.reason, b.version));
});
