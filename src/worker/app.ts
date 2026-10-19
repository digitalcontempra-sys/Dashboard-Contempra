import type { SessionUser } from "../shared/types";
import type { Env } from "./env";

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
