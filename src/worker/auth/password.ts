const ITERATIONS = 100_000; // workerd's PBKDF2 maximum
const SALT_BYTES = 16;
const HASH_BITS = 256;

export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_ERROR = "Password must be at least 8 characters";

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(pw, salt, ITERATIONS))}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const expected = fromB64(hash);
  const actual = await derive(pw, fromB64(salt), Number(iter));
  if (actual.length !== expected.length) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
}

export const isValidPassword = (pw: unknown): pw is string =>
  typeof pw === "string" && pw.length >= MIN_PASSWORD_LENGTH;
