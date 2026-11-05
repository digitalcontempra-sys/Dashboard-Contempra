import { createElement } from "react";
import type { DocketForm } from "../../shared/docketForm";

/** Renders the docket PDF in the browser. The PDF library is loaded on demand (its own bundle chunk). */
export async function renderDocketPdf(form: DocketForm, workOrder: string, showPrices: boolean): Promise<Blob> {
  const [{ pdf }, { DocketPdf }] = await Promise.all([import("@react-pdf/renderer"), import("./DocketPdf")]);
  return pdf(createElement(DocketPdf, { form, workOrder, showPrices }) as never).toBlob();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
