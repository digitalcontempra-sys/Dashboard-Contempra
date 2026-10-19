// Local development bootstrap: creates the first admin from .dev.vars and imports a fixture.
// Usage: node scripts/dev-setup.mjs [values.json] [baseUrl]
// .dev.vars must contain SETUP_TOKEN, DEV_ADMIN_USER and DEV_ADMIN_PASSWORD.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "fixtures/local/contempra-values.json";
const base = process.argv[3] ?? "http://localhost:5173";

const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf-8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
for (const k of ["SETUP_TOKEN", "DEV_ADMIN_USER", "DEV_ADMIN_PASSWORD"]) {
  if (!vars[k]) throw new Error(`.dev.vars is missing ${k}`);
}

const setup = await fetch(new URL("/api/setup", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    setupToken: vars.SETUP_TOKEN,
    username: vars.DEV_ADMIN_USER,
    fullName: "Local Admin",
    password: vars.DEV_ADMIN_PASSWORD,
  }),
});
console.log(setup.ok ? "Admin created" : `Setup skipped (${setup.status}): admin probably exists already`);

execFileSync(
  process.execPath,
  ["scripts/import-fixture.mjs", file, base, vars.DEV_ADMIN_USER, vars.DEV_ADMIN_PASSWORD],
  { stdio: "inherit" },
);
