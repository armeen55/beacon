"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
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
  const action = "triggerPageScan";
  const t0 = Date.now();
  log.info("Action started", { action, params: {} });
  const r = await runWebsiteScan({ trigger: "pages" });
  const p = r.payload;

  if (scanRoutesShouldRevalidate(r)) {
    revalidatePath("/", "layout");
    revalidatePath("/pages", "layout");
  }

  const out = {
    success: r.ok,
    pagesScanned: p?.pagesScanned,
    pagesChanged: p?.pagesChanged,
    alertCount: p?.guardrailAlertCount,
    error: r.error,
  };
  if (out.success) {
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
  } else {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: out.error ?? "scan failed",
    });
  }
  return out;
}
