export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_SA_JSON: string;
  SHEET_ID: string;
  SETUP_TOKEN: string;
  ENVIRONMENT: "development" | "production";
}
