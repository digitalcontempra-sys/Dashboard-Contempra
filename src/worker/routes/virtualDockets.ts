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
import { MAX_PDF_BYTES, pdfKey, storeDocketPdf, syncDocketPdfToDrive } from "../dockets/pdf";

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

virtualDocketRoutes.put("/virtual-dockets/:wo/pdf", editors, async (c) => {
  const wo = c.req.param("wo");
  const exists = await c.env.DB.prepare("SELECT 1 FROM virtual_dockets WHERE work_order = ? AND state = 'saved'").bind(wo).first();
  if (!exists) return c.json({ error: "Work order not found" }, 404);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_PDF_BYTES) return c.json({ error: "PDF is too large (max 5 MB)" }, 413);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > MAX_PDF_BYTES) return c.json({ error: "PDF is too large (max 5 MB)" }, 413);
  await storeDocketPdf(c.env, wo, bytes);
  c.executionCtx.waitUntil(syncDocketPdfToDrive(c.env, wo));
  return c.json({ ok: true });
});

// The stored PDF includes prices, so Staff render their own price-free copy in the browser.
virtualDocketRoutes.get("/virtual-dockets/:wo/pdf", editors, async (c) => {
  const obj = await c.env.DOCKETS_BUCKET.get(pdfKey(c.req.param("wo")));
  if (!obj) return c.json({ error: "PDF not found" }, 404);
  return new Response(obj.body, {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${c.req.param("wo")}.pdf"` },
  });
});
