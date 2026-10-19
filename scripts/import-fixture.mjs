// Usage: node scripts/import-fixture.mjs <values.json> <baseUrl> <username> <password>
// Signs in as an admin and posts the values to /api/dev/import (development only).
import { readFile } from "node:fs/promises";

const [file, base, username, password] = process.argv.slice(2);
if (!file || !base || !username || !password) {
  console.error("Usage: node scripts/import-fixture.mjs <values.json> <baseUrl> <username> <password>");
  process.exit(1);
}

const login = await fetch(new URL("/api/auth/login", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username, password }),
});
if (!login.ok) {
  console.error("Login failed:", login.status, await login.text());
  process.exit(1);
}
const cookie = login.headers.get("set-cookie").split(";")[0];

const body = await readFile(file, "utf-8");
const res = await fetch(new URL("/api/dev/import", base), {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body,
});
console.log(res.status, await res.text());
process.exitCode = res.ok ? 0 : 1;
