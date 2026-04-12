import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  scanRoutesShouldRevalidate,
  type WebsiteScanResult,
} from "@/domains/scanning/orchestrate-scan";

describe("orchestrate-scan render safety", () => {
  it("orchestrate-scan.ts does not reference revalidatePath", () => {
    const src = readFileSync(
      join(process.cwd(), "src/domains/scanning/orchestrate-scan.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\brevalidatePath\b/);
  });

  it("Today page does not call revalidatePath during render", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(shell)/page.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/\brevalidatePath\b/);
  });

  it("postImportSetup uses scanRoutesShouldRevalidate before revalidatePath(/pages)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/import/actions.ts"),
      "utf8",
    );
    expect(src).toMatch(/scanRoutesShouldRevalidate/);
    expect(src).toMatch(/revalidatePath\("\/pages"/);
  });

  it("scanRoutesShouldRevalidate is false for failed or dry-run payloads", () => {
    const failed: WebsiteScanResult = {
      ok: false,
      phase: "failed",
      payload: {
        schemaVersion: 1,
        finishedAt: "2026-01-01T00:00:00.000Z",
        exit: "failed",
        observationRunId: null,
        pagesScanned: 0,
        pagesChanged: 0,
        pagesWithErrors: 0,
        guardrailAlertCount: 0,
      },
      findingsAdded: 0,
    };
    expect(scanRoutesShouldRevalidate(failed)).toBe(false);

    const dry: WebsiteScanResult = {
      ok: true,
      phase: "success",
      payload: {
        schemaVersion: 1,
        finishedAt: "2026-01-01T00:00:00.000Z",
        exit: "success",
        observationRunId: null,
        pagesScanned: 0,
        pagesChanged: 0,
        pagesWithErrors: 0,
        guardrailAlertCount: 0,
        dryRun: true,
      },
      findingsAdded: 0,
    };
    expect(scanRoutesShouldRevalidate(dry)).toBe(false);
  });
});
