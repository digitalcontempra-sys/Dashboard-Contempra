import type { Env } from "../env";
import { realDriveGateway, type DriveGateway } from "./drive";
import { realSheetGateway, type SheetGateway } from "./sheets";

export type Gateways = { sheet: SheetGateway; drive: DriveGateway };

let override: Gateways | null = null;

/** Test-only: replace the Google gateways with in-memory fakes. Ignored in production. */
export function __setTestGateways(g: Gateways | null): void {
  override = g;
}

export function getGateways(env: Env): Gateways {
  if (override && env.ENVIRONMENT !== "production") return override;
  return { sheet: realSheetGateway(env), drive: realDriveGateway(env) };
}
