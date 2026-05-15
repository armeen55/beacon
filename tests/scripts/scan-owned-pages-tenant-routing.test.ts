/**
 * Architecture invariant: scripts/scan-owned-pages.ts CLI must write
 * tenant-scoped scan outputs to `.data/tenants/{slug}/...` and global
 * outputs to `.data/global/...`. Pre-patch (2026-04-28) the CLI wrote
 * everything to root `.data/...`, producing a split-brain where the
 * runtime (which routes via store-classification) read stale tenant
 * files while the CLI's fresh data sat in the root. The lifecycle
 * runner produced false negatives for the H2 positive-control test.
 *
 * This source-scan test pins the path constructions per file so a
 * future refactor can't silently regress to root.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI_SRC = readFileSync(
  resolve(__dirname, "../../scripts/scan-owned-pages.ts"),
  "utf8",
);

describe("scan-owned-pages CLI — tenant-routing invariants (2026-04-28)", () => {
  it("imports mkdirSync (needed to create tenant dir on first run)", () => {
    expect(CLI_SRC).toMatch(
      /import\s*\{\s*[^}]*\bmkdirSync\b[^}]*\}\s*from\s*["']node:fs["']/,
    );
  });

  it("declares TENANT_SLUG resolution from BEACON_TENANT_SLUG env", () => {
    expect(CLI_SRC).toMatch(/TENANT_SLUG\s*=\s*process\.env\.BEACON_TENANT_SLUG/);
  });

  it("requireTenantDir() helper exists and fail-louds on missing slug", () => {
    expect(CLI_SRC).toMatch(/function\s+requireTenantDir\s*\(\)/);
    // The helper throws an explicit error mentioning BEACON_TENANT_SLUG
    // — this is the fail-loud guard against silently writing tenant
    // data to root (the bug Sprint 7.8c surfaced).
    expect(CLI_SRC).toMatch(
      /BEACON_TENANT_SLUG is required for tenant-scoped scan outputs/,
    );
  });

  it("globalDir() helper exists and points at .data/global", () => {
    expect(CLI_SRC).toMatch(/function\s+globalDir\s*\(\)/);
    expect(CLI_SRC).toMatch(/join\(DATA_DIR,\s*["']global["']\)/);
  });

  // ── Per-file write-path invariants ──
  // Every tenant-scoped scan output must use requireTenantDir().

  const TENANT_FILES = [
    "page-snapshots.json",
    "page-snapshots-prev.json",
    "page-element-inventory.json",
    "page-snapshot-diffs.json",
    "page-guardrails.json",
    "scan-runs.json",
    "observation-runs.json",
    "render-checks.json",
  ];

  for (const file of TENANT_FILES) {
    it(`tenant-scoped: ${file} uses requireTenantDir()`, () => {
      // Source must contain at least one path construction joining
      // requireTenantDir() with this filename. Guards against any
      // future refactor that drops the tenant routing for this file.
      const escaped = file.replace(/[.]/g, "\\.");
      const pattern = new RegExp(
        `join\\s*\\(\\s*requireTenantDir\\(\\)\\s*,\\s*["']${escaped}["']\\s*\\)`,
      );
      expect(CLI_SRC).toMatch(pattern);
    });

    it(`tenant-scoped: ${file} is NEVER written to root .data via join(DATA_DIR, ...)`, () => {
      // Defense: catch a silent regression to root for this filename.
      const escaped = file.replace(/[.]/g, "\\.");
      const badPattern = new RegExp(
        `join\\s*\\(\\s*DATA_DIR\\s*,\\s*["']${escaped}["']\\s*\\)`,
      );
      expect(CLI_SRC).not.toMatch(badPattern);
    });
  }

  // ── Global-scoped invariants ──

  // Phase A.3 (post-A.3.5, 2026-05-15) — sitemap-reconciliation was
  // moved from GLOBAL_STORES → TENANT_SCOPED_STORES alongside a new
  // `public.sitemap_reconciliation` Supabase mirror. The pre-A.3
  // write path — `join(globalDir(), "sitemap-reconciliation.json")`
  // — is RETIRED. The new write contract is:
  //   • `saveReconciliation` is async and takes `tenantId`.
  //   • Writes route through `repo.setSitemapReconciliation(...)`
  //     (Supabase UPSERT in production; tenant-routed dotdata on
  //     dev), NEVER through the legacy global flat file.
  //
  // The companion architecture invariant
  // `tests/architecture/sitemap-reconciliation-supabase-mirror.test.ts`
  // covers the repository-side write path; this test pins the
  // scan-script-side of the contract (the caller surface).
  it("sitemap-reconciliation write goes through repo.setSitemapReconciliation (tenant-scoped, post-A.3)", () => {
    // The script must declare `saveReconciliation` as async +
    // tenant-scoped.
    expect(CLI_SRC).toMatch(
      /\basync\s+function\s+saveReconciliation\s*\(/,
    );
    expect(CLI_SRC).toMatch(
      /saveReconciliation\s*\([\s\S]*?tenantId\s*:\s*string[\s\S]*?\)\s*:\s*Promise<void>/,
    );
    // The script must route the write through the repository's
    // tenant-scoped setter, NOT the legacy global flat file.
    expect(CLI_SRC).toMatch(/setSitemapReconciliation\s*\(/);
    // Defense against regression to either the legacy global
    // flat-path write OR the root-data-dir write.
    expect(CLI_SRC).not.toMatch(
      /join\s*\(\s*globalDir\(\)\s*,\s*["']sitemap-reconciliation\.json["']\s*\)/,
    );
    expect(CLI_SRC).not.toMatch(
      /join\s*\(\s*DATA_DIR\s*,\s*["']sitemap-reconciliation\.json["']\s*\)/,
    );
  });

  // ── Read-path invariants for cross-tenant + per-tenant inputs ──

  it("citation-evidence-index reads from tenant dir (with legacy root fallback)", () => {
    // Reads can keep a legacy fallback for partially-migrated repos —
    // pin that BOTH paths are referenced.
    expect(CLI_SRC).toMatch(
      /join\s*\(\s*requireTenantDir\(\)\s*,\s*["']citation-evidence-index\.json["']\s*\)/,
    );
  });

  it("business-config reads from globalDir() (with legacy root fallback)", () => {
    expect(CLI_SRC).toMatch(
      /join\s*\(\s*globalDir\(\)\s*,\s*["']business-config\.json["']\s*\)/,
    );
  });
});
