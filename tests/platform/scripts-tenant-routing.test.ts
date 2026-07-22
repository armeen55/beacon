/**
 * PLATFORM — script tenant-routing safety (Core 100K terminal suite; merged
 * from tests/scripts/scan-owned-pages-tenant-routing.test.ts, the safety
 * boundaries of tests/scripts/reset-test-tenant.test.ts, and the scanning
 * fold-in from tests/scanning/comparison-table.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALLOWED_DELETE_TABLES,
  RESETTABLE_STATUSES,
  isProtectedSlug,
} from "../../scripts/reset-test-tenant";
import { extractPageSnapshot } from "@/domains/pages/extractor";

const CLI_SRC = readFileSync(resolve(__dirname, "../../scripts/scan-owned-pages.ts"), "utf8");

describe("scan-owned-pages CLI — tenant-routing invariants", () => {
  it("resolves TENANT_SLUG from env and fail-louds when it is missing", () => {
    expect(CLI_SRC).toMatch(/TENANT_SLUG\s*=\s*process\.env\.BEACON_TENANT_SLUG/);
    expect(CLI_SRC).toMatch(/function\s+requireTenantDir\s*\(\)/);
    expect(CLI_SRC).toMatch(/BEACON_TENANT_SLUG is required for tenant-scoped scan outputs/);
    expect(CLI_SRC).toMatch(/function\s+globalDir\s*\(\)/);
    expect(CLI_SRC).toMatch(/join\(DATA_DIR,\s*["']global["']\)/);
  });

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
    it(`tenant-scoped output ${file} routes through requireTenantDir() and never root .data`, () => {
      const escaped = file.replace(/[.]/g, "\\.");
      expect(CLI_SRC).toMatch(
        new RegExp(`join\\s*\\(\\s*requireTenantDir\\(\\)\\s*,\\s*["']${escaped}["']\\s*\\)`),
      );
      expect(CLI_SRC).not.toMatch(new RegExp(`join\\s*\\(\\s*DATA_DIR\\s*,\\s*["']${escaped}["']\\s*\\)`));
    });
  }

  it("sitemap-reconciliation writes go through repo.setSitemapReconciliation (tenant-scoped), never a flat file", () => {
    expect(CLI_SRC).toMatch(/\basync\s+function\s+saveReconciliation\s*\(/);
    expect(CLI_SRC).toMatch(/setSitemapReconciliation\s*\(/);
    expect(CLI_SRC).not.toMatch(/join\s*\(\s*globalDir\(\)\s*,\s*["']sitemap-reconciliation\.json["']\s*\)/);
    expect(CLI_SRC).not.toMatch(/join\s*\(\s*DATA_DIR\s*,\s*["']sitemap-reconciliation\.json["']\s*\)/);
  });
});

describe("reset-test-tenant safety boundaries", () => {
  it("refuses every Ritz-shaped slug (the production tenant is untouchable)", () => {
    for (const protectedSlug of ["tenant-ritz-founder", "ritz-builders", "RITZ", "RiTz-Builders", "not-ritz", "tenant-ritz-anything"]) {
      expect(isProtectedSlug(protectedSlug), protectedSlug).toBe(true);
    }
    expect(isProtectedSlug("acme-test")).toBe(false);
    expect(isProtectedSlug("8c9d2f4a")).toBe(false);
  });

  it("only pending_onboarding/active tenants are resettable; operator-set states are off-limits", () => {
    expect(RESETTABLE_STATUSES.has("pending_onboarding")).toBe(true);
    expect(RESETTABLE_STATUSES.has("active")).toBe(true);
    expect(RESETTABLE_STATUSES.has("paused")).toBe(false);
    expect(RESETTABLE_STATUSES.has("cancelled")).toBe(false);
  });

  it("the delete allowlist is exactly { tracked_prompts, tenant_members, tenants } (defense in depth)", () => {
    expect(ALLOWED_DELETE_TABLES.size).toBe(3);
    for (const allowed of ["tracked_prompts", "tenant_members", "tenants"]) {
      expect(ALLOWED_DELETE_TABLES.has(allowed)).toBe(true);
    }
    for (const forbidden of ["prompt_answer_observations", "daily_metric_snapshots", "recommended_edits", "changelog_entries"]) {
      expect(ALLOWED_DELETE_TABLES.has(forbidden)).toBe(false);
    }
  });
});

describe("scan extractor table detection (scanning fold-in)", () => {
  const BASE_URL = "https://example.com/test";
  const page = (body: string) =>
    `<html><head><title>Test</title><meta name="description" content="Test"><link rel="canonical" href="${BASE_URL}"></head><body><h1>Test Page</h1><p>${"Content padding. ".repeat(20)}</p>${body}</body></html>`;

  it("counts meaningful tables (>=2 rows) and ignores decorative single-row tables", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `<tr><td>Cell ${i}</td><td>Value ${i}</td></tr>`).join("");
    const withTable = extractPageSnapshot(page(`<table><tbody>${rows}</tbody></table>`), BASE_URL, "pg-1", "tenant-test");
    expect(withTable.table_count).toBe(1);
    const decorative = extractPageSnapshot(page("<table><tr><td>Just one row</td></tr></table>"), BASE_URL, "pg-1", "tenant-test");
    expect(decorative.table_count).toBe(0);
  });
});
