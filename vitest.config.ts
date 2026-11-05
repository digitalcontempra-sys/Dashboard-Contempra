import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                SETUP_TOKEN: "test-setup-token",
                GOOGLE_CLIENT_ID: "test-client-id",
                GOOGLE_CLIENT_SECRET: "test-client-secret",
                TOKEN_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
                ENVIRONMENT: "development",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          setupFiles: ["./test/worker/setup.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["test/web/**/*.test.{ts,tsx}", "test/shared/**/*.test.ts"],
          environment: "jsdom",
          setupFiles: ["./test/web/setup.ts"],
        },
      },
    ],
  },
});
