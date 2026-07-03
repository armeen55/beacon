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

  it("Phase 7.7e: runWebsiteScan injects BEACON_TENANT_ID into the spawned CLI's env", () => {
    // The spawned CLI (scripts/scan-owned-pages.ts) requires
    // BEACON_TENANT_ID via Phase 7.5d fail-loud. orchestrate-scan must
    // pass it explicitly rather than relying on `...process.env`
    // inheritance — the orchestrator is the only place that knows the
    // resolved request-scope tenant.
    const src = readFileSync(
      join(process.cwd(), "src/domains/scanning/orchestrate-scan.ts"),
      "utf8",
    );
    // The execEnv literal must list BEACON_TENANT_ID alongside tenantId.
    // Match the exact assignment shape so a future regression to a
    // bare `...process.env` fallback fails this invariant loudly.
    expect(src).toMatch(/BEACON_TENANT_ID:\s*tenantId/);
    // And the resolved tenantId itself must come from currentTenantId,
    // hoisted at the top of runWebsiteScan (Phase 7.7b Commit 3).
    expect(src).toMatch(
      /const tenantId\s*=\s*await currentTenantId\(\)/,
    );
  });

  it("Today page does not call revalidatePath during render", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(shell)/page.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/\brevalidatePath\b/);
  });

  it("postImportSetup uses scanRoutesShouldRevalidate before revalidatePath(/changes)", () => {
    // Was /pages, deleted 2026-07-02 (UX5 legacy sweep, zero inbound links);
    // /changes (Changes) is the live surface where scanned page changes
    // now actually reach the operator.
    const src = readFileSync(
      join(process.cwd(), "src/lib/import/actions.ts"),
      "utf8",
    );
    expect(src).toMatch(/scanRoutesShouldRevalidate/);
    expect(src).toMatch(/revalidatePath\("\/changes"/);
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
