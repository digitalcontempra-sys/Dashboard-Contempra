import { Hono } from "hono";
import type { DocketForm, ProductionJob } from "../../shared/docketForm";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import {
  cancelDocket,
  createDocket,
  deleteDocket,
  getVirtualDocket,
  listTrash,
  restoreDocket,
  ServiceError,
  updateDocket,
} from "../dockets/service";

type Body = { form?: DocketForm; jobs?: ProductionJob[]; version?: number; confirm?: string };

export const virtualDocketRoutes = new Hono<AppEnv>();
virtualDocketRoutes.use("/virtual-dockets", requireAuth);
virtualDocketRoutes.use("/virtual-dockets/*", requireAuth);
virtualDocketRoutes.use("/trash", requireAuth, requireLevel("admin"));

virtualDocketRoutes.onError((e, c) => {
  if (e instanceof ServiceError) return c.json({ error: e.message }, e.status);
  throw e;
});

const editors = requireLevel("admin", "manager");
const admins = requireLevel("admin");

virtualDocketRoutes.post("/virtual-dockets", editors, async (c) =>
  c.json(await createDocket(c.env, c.get("user"), await c.req.json<Body>())),
);

virtualDocketRoutes.get("/virtual-dockets/:wo", async (c) => c.json(await getVirtualDocket(c.env, c.get("user"), c.req.param("wo"))));

virtualDocketRoutes.put("/virtual-dockets/:wo", editors, async (c) =>
  c.json(await updateDocket(c.env, c.get("user"), c.req.param("wo"), await c.req.json<Body>())),
);

virtualDocketRoutes.post("/virtual-dockets/:wo/cancel", editors, async (c) => {
  await cancelDocket(c.env, c.req.param("wo"));
  return c.json({ ok: true });
});

virtualDocketRoutes.delete("/virtual-dockets/:wo", admins, async (c) => {
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  await deleteDocket(c.env, c.get("user"), c.req.param("wo"), body.confirm);
  return c.json({ ok: true });
});

virtualDocketRoutes.post("/virtual-dockets/:wo/restore", admins, async (c) => {
  await restoreDocket(c.env, c.req.param("wo"));
  return c.json({ ok: true });
});

virtualDocketRoutes.get("/trash", async (c) => c.json(await listTrash(c.env)));
