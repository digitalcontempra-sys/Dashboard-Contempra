/** Each user's codes in sheet column J (Account Manager). The first one is the main code. */

export class CodesError extends Error {
  constructor(
    public status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

const CODE = /^[A-Z0-9]{1,10}$/;

/** Upper case, no spaces, no repeats; empty entries are dropped. Throws on anything else. */
export function normalizeCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new CodesError(400, "Initials must be a list");
  const out: string[] = [];
  for (const r of raw) {
    const code = String(r ?? "").replace(/\s+/g, "").toUpperCase();
    if (!code) continue;
    if (!CODE.test(code)) throw new CodesError(400, "Initials must be letters or numbers (up to 10).");
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export async function userCodes(db: D1Database, userId: number): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT code FROM user_codes WHERE user_id = ? ORDER BY sort")
    .bind(userId)
    .all<{ code: string }>();
  return results.map((r) => r.code);
}

/** 409 when another user (not `userId`; null for a new user) already has one of the codes. */
export async function assertCodesFree(db: D1Database, codes: string[], userId: number | null): Promise<void> {
  for (const code of codes) {
    const owner = await db
      .prepare("SELECT u.full_name FROM user_codes c JOIN users u ON u.id = c.user_id WHERE c.code = ? AND c.user_id != ?")
      .bind(code, userId ?? 0)
      .first<{ full_name: string }>();
    if (owner) throw new CodesError(409, `Initials ${code} already belong to ${owner.full_name}.`);
  }
}

/** Statements that replace a user's codes (check them with assertCodesFree first). */
export function codeStatements(db: D1Database, userId: number, codes: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM user_codes WHERE user_id = ?").bind(userId),
    ...codes.map((code, i) => db.prepare("INSERT INTO user_codes (code, user_id, sort) VALUES (?, ?, ?)").bind(code, userId, i)),
  ];
}

/** Two admins giving the same code at once: the primary key refuses the second one. */
export async function withCodeConflict<T>(codes: string[], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (/UNIQUE constraint failed: user_codes/i.test(String((e as Error)?.message ?? e))) {
      throw new CodesError(409, `Initials ${codes.join(", ")} were just given to someone else. Reload and try again.`);
    }
    throw e;
  }
}
