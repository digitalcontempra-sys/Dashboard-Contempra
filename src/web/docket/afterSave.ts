import type { QueryClient } from "@tanstack/react-query";
import type { VirtualDocketDTO } from "../../shared/types";
import { renderDocketPdf } from "./renderPdf";

const inFlight = new Set<string>();

/**
 * Renders the PDF (with prices; only editors call this) and uploads it; the server copies it to Drive.
 * One upload per docket version: the editor remounting right after a save does not upload again.
 */
export async function afterDocketSaved(dto: VirtualDocketDTO, qc: QueryClient): Promise<void> {
  const key = `${dto.workOrder}@${dto.version}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const blob = await renderDocketPdf(dto.form, dto.workOrder, true);
    const res = await fetch(`/api/virtual-dockets/${encodeURIComponent(dto.workOrder)}/pdf?version=${dto.version}`, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      credentials: "include",
      body: blob,
    });
    if (res.ok) qc.invalidateQueries({ queryKey: ["virtual-docket", dto.workOrder] });
  } catch {
    // The docket is saved; a missing PDF is regenerated the next time an editor opens it.
  } finally {
    inFlight.delete(key);
  }
}
