"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  runWebsiteScan,
  scanRoutesShouldRevalidate,
  type WebsiteScanResult,
} from "@/domains/scanning/orchestrate-scan";

export type TriggerScanResponse = {
  status: "ok" | "error";
  result?: WebsiteScanResult;
  error?: string;
};

export async function triggerScan(): Promise<TriggerScanResponse> {
  const action = "triggerScan";
  const t0 = Date.now();
  log.info("Action started", { action, params: {} });
  try {
    const r = await runWebsiteScan({ trigger: "today" });

    if (scanRoutesShouldRevalidate(r)) {
      revalidatePath("/", "layout");
      revalidatePath("/pages", "layout");
    }

    const out: TriggerScanResponse = {
      status: r.ok ? "ok" : "error",
      result: r,
      error: r.ok ? undefined : r.error,
    };
    if (out.status === "error") {
      log.error("Action failed", {
        action,
        durationMs: Date.now() - t0,
        error: out.error ?? "scan returned error",
      });
    } else {
      log.info("Action completed", { action, durationMs: Date.now() - t0 });
    }
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: msg.slice(0, 500),
    });
    return { status: "error", error: msg };
  }
}
