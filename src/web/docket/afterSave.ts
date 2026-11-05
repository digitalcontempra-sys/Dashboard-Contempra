import type { QueryClient } from "@tanstack/react-query";
import type { VirtualDocketDTO } from "../../shared/types";

/** Runs after a docket is saved. Task 8 renders and uploads the PDF here. */
export async function afterDocketSaved(_dto: VirtualDocketDTO, _qc: QueryClient): Promise<void> {}
