import type { Env } from "../env";
import { realDriveGateway, type DriveGateway } from "./drive";
import { layoutAware, statusColumnOn } from "../sheet/layout";
import { realSheetGateway, type SheetGateway } from "./sheets";

export type Gateways = { sheet: SheetGateway; drive: DriveGateway };

let override: Gateways | null = null;

/** Test-only: replace the Google gateways with in-memory fakes. Ignored in production. */
export function __setTestGateways(g: Gateways | null): void {
  override = g;
}

/** The Google gateways; the sheet speaks the original column letters whatever the sheet's layout. */
export function getGateways(env: Env): Gateways {
  const g = getRawGateways(env);
  return { ...g, sheet: layoutAware(g.sheet, () => statusColumnOn(env.DB)) };
}

/** Without the layout translation: physical columns (only for inserting the STATUS column). */
export function getRawGateways(env: Env): Gateways {
  if (override && env.ENVIRONMENT !== "production") return override;
  return { sheet: realSheetGateway(env), drive: realDriveGateway(env) };
}
