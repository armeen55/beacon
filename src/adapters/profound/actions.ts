"use server";

import { revalidatePath } from "next/cache";
import { runProfoundImport, type ProfoundImportResult } from "./import-orchestrator";

export async function importProfoundData(): Promise<ProfoundImportResult> {
  const result = await runProfoundImport("ritz-builders");
  revalidatePath("/", "layout");
  return result;
}
