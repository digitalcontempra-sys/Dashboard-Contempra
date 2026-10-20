// Creates the FIRST admin on a deployed dashboard (works only while no users exist).
// Usage: node scripts/create-admin.mjs https://dashboard-contempra.digitalcontempra.workers.dev
// Reads SETUP_TOKEN from .prod.vars and asks for the username, full name and password.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/create-admin.mjs <dashboard url>");
  process.exit(1);
}
const token = readFileSync(".prod.vars", "utf-8").match(/^SETUP_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error(".prod.vars has no SETUP_TOKEN");

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : s.replace(/[^\r\n]/g, "*"));
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const username = await ask("Username: ");
const fullName = await ask("Full name: ");
const password = await ask("Password (8+ characters): ", true);
const again = await ask("Repeat password: ", true);
if (password !== again) {
  console.error("Passwords do not match.");
  process.exitCode = 1;
} else {
  const res = await fetch(new URL("/api/setup", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ setupToken: token, username, fullName, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) console.log(`Admin "${username}" created. Sign in at ${new URL("/login", base)}`);
  else console.error(`Setup failed (${res.status}): ${body.error ?? "unknown error"}`);
  process.exitCode = res.ok ? 0 : 1;
}
