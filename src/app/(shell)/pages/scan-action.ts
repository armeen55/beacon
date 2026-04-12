"use server";

import { revalidatePath } from "next/cache";
import {
  runWebsiteScan,
  scanRoutesShouldRevalidate,
} from "@/domains/scanning/orchestrate-scan";

export async function triggerPageScan(): Promise<{
  success: boolean;
  pagesScanned?: number;
  pagesChanged?: number;
  alertCount?: number;
  error?: string;
}> {
  const r = await runWebsiteScan({ trigger: "pages" });
  const p = r.payload;

  if (scanRoutesShouldRevalidate(r)) {
    revalidatePath("/", "layout");
    revalidatePath("/pages", "layout");
  }

  return {
    success: r.ok,
    pagesScanned: p?.pagesScanned,
    pagesChanged: p?.pagesChanged,
    alertCount: p?.guardrailAlertCount,
    error: r.error,
  };
}
