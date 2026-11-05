// AES-GCM encryption for secrets stored in D1 (the Google refresh token).
// Format: v1.<ivB64>.<cipherB64>. The key is a base64 32-byte secret (TOKEN_KEY).

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(keyB64), new TextEncoder().encode(plain)),
  );
  return `v1.${toB64(iv)}.${toB64(cipher)}`;
}

export async function decryptSecret(enc: string, keyB64: string): Promise<string> {
  const [version, iv, cipher] = enc.split(".");
  if (version !== "v1" || !iv || !cipher) throw new Error("Unknown secret format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await importKey(keyB64), fromB64(cipher));
  return new TextDecoder().decode(plain);
}
