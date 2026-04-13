"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { runProfoundImport, type ProfoundImportResult } from "./import-orchestrator";

export async function importProfoundData(): Promise<ProfoundImportResult> {
  const action = "importProfoundData";
  const t0 = Date.now();
  log.info("Action started", { action, params: { tenant: "ritz-builders" } });
  const result = await runProfoundImport("ritz-builders");
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
