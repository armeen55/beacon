"use server";

import { revalidatePath } from "next/cache";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function triggerPageScan(): Promise<{
  success: boolean;
  pagesScanned?: number;
  pagesChanged?: number;
  alertCount?: number;
  error?: string;
}> {
  try {
    const cmd =
      "npx tsx --require ./scripts/mock-server-only.cjs scripts/scan-owned-pages.ts";
    const { stdout } = await execAsync(cmd, {
      cwd: process.cwd(),
      timeout: 120_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });

    const scannedMatch = stdout.match(/Scanned successfully:\s+(\d+)/);
    const changedMatch = stdout.match(/\((\d+) changed/);
    const alertMatch = stdout.match(/Guardrail Alerts \((\d+)\)/);

    revalidatePath("/", "layout");

    return {
      success: true,
      pagesScanned: scannedMatch ? parseInt(scannedMatch[1], 10) : undefined,
      pagesChanged: changedMatch ? parseInt(changedMatch[1], 10) : undefined,
      alertCount: alertMatch ? parseInt(alertMatch[1], 10) : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg.slice(0, 500) };
  }
}
