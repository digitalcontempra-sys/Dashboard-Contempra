import { ServiceError } from "./errors";

const TTL_MS = 30_000;
const WAIT_MS = 10_000;
const POLL_MS = 80;

/**
 * Runs `fn` while holding a short D1 lease named `name`, so the app's own Google writes never
 * interleave (an insert at the top shifts every row another request just located).
 */
export async function withLock<T>(db: D1Database, name: string, fn: () => Promise<T>): Promise<T> {
  const holder = crypto.randomUUID();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const now = new Date();
    const res = await db
      .prepare(
        `INSERT INTO locks (name, holder, expires_at) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
         WHERE locks.expires_at < ?`,
      )
      .bind(name, holder, new Date(now.getTime() + TTL_MS).toISOString(), now.toISOString())
      .run();
    if (res.meta.changes > 0) break;
    if (Date.now() > deadline) throw new ServiceError(503, "Someone else is saving right now. Try again in a moment.");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    return await fn();
  } finally {
    await db.prepare("DELETE FROM locks WHERE name = ? AND holder = ?").bind(name, holder).run();
  }
}
