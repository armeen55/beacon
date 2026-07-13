"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { runProfoundImport, type ProfoundImportResult } from "./import-orchestrator";

export async function importProfoundData(): Promise<ProfoundImportResult> {
  const action = "importProfoundData";
  const t0 = Date.now();
  const tenantId = await currentTenantId();
  log.info("Action started", { action, tenantId });
  const result = await runProfoundImport(tenantId);
  revalidatePath("/", "layout");
  if (!result.success) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: (result.errors[0] ?? "import failed").slice(0, 500),
    });
  } else {
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
  }
  return result;
}
