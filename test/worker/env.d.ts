declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    TOKEN_KEY: string;
    DOCKETS_BUCKET: R2Bucket;
    SETUP_TOKEN: string;
    ENVIRONMENT: "development" | "production";
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}
