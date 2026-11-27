export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** base64 32-byte AES key that encrypts the stored Google refresh token. */
  TOKEN_KEY: string;
  DOCKETS_BUCKET: R2Bucket;
  SETUP_TOKEN: string;
  ENVIRONMENT: "development" | "production";
  /** Deploy id (wrangler `version_metadata`): part of the polled responses' ETag. Absent in tests. */
  CF_VERSION_METADATA?: { id: string };
}
