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
}
