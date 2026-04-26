/**
 * Sprint 7 Phase 7.8b-0 (2026-04-25) — sanity tests for the shared
 * classification module.
 *
 * The migration script tests already exercise the three Sets (via
 * re-export); this file pins the new `classifyStore()` dispatch and
 * cross-checks the Sets are disjoint at the canonical source.
 */

import { describe, it, expect } from "vitest";
import {
  GLOBAL_STORES,
  SINGLETON_STORES,
  TENANT_SCOPED_STORES,
  classifyStore,
} from "@/lib/persistence/store-classification";

describe("Phase 7.8b-0 — store-classification module", () => {
  it("the three classification Sets are pairwise disjoint", () => {
    const all = [
      ...TENANT_SCOPED_STORES,
      ...SINGLETON_STORES,
      ...GLOBAL_STORES,
    ];
    const dedup = new Set(all);
    expect(dedup.size).toBe(all.length);
  });

  it("classifyStore returns 'per-tenant' for tenant-scoped stores", () => {
    expect(classifyStore("imported-results")).toBe("per-tenant");
    expect(classifyStore("page-snapshots")).toBe("per-tenant");
    expect(classifyStore("recommended-edits")).toBe("per-tenant");
    expect(classifyStore("url-change-outcomes")).toBe("per-tenant");
  });

  it("classifyStore returns 'singleton' for per-tenant singleton stores", () => {
    expect(classifyStore("citation-evidence-index")).toBe("singleton");
    expect(classifyStore("answer-intelligence-index")).toBe("singleton");
    expect(classifyStore("robots-state")).toBe("singleton");
    expect(classifyStore("url-watcher-state")).toBe("singleton");
  });

  it("classifyStore returns 'global' for global stores", () => {
    expect(classifyStore("business-config")).toBe("global");
    expect(classifyStore("change-patterns")).toBe("global");
    expect(classifyStore("triage-rules")).toBe("global");
    expect(classifyStore("scan-state")).toBe("global");
    expect(classifyStore("tenants")).toBe("global");
    expect(classifyStore("shared-brain")).toBe("global");
  });

  it("classifyStore returns 'unknown' for unrecognized store names", () => {
    expect(classifyStore("brand-new-store-xyz")).toBe("unknown");
    expect(classifyStore("experiments.removed-phase4")).toBe("unknown");
    expect(classifyStore("")).toBe("unknown");
  });

  it("classifyStore is a pure function — no I/O, no env access", () => {
    // Calling it 100 times with the same input is fine and stable.
    for (let i = 0; i < 100; i++) {
      expect(classifyStore("imported-results")).toBe("per-tenant");
      expect(classifyStore("business-config")).toBe("global");
    }
  });
});
