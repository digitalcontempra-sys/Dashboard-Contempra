import type { QueryClient } from "@tanstack/react-query";
import type { VirtualDocketDTO } from "../../shared/types";
import { renderDocketPdf } from "./renderPdf";

/** Renders the PDF (with prices; only editors call this) and uploads it; the server copies it to Drive. */
export async function afterDocketSaved(dto: VirtualDocketDTO, qc: QueryClient): Promise<void> {
  try {
    const blob = await renderDocketPdf(dto.form, dto.workOrder, true);
    const res = await fetch(`/api/virtual-dockets/${encodeURIComponent(dto.workOrder)}/pdf`, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      credentials: "include",
      body: blob,
    });
    if (res.ok) qc.invalidateQueries({ queryKey: ["virtual-docket", dto.workOrder] });
  } catch {
    // The docket is saved; a missing PDF is regenerated the next time an editor opens it.
  }
}
