/**
 * Architecture invariant — GENERATION-SNAPSHOTS-UNBOUNDED (audit #12, 2026-06-14).
 *
 * The egress-pinned web reader `getPageSnapshots()` is hard-capped at
 * LIMIT 500 (see egress-bounded-reads-p0.test.ts). That cap silently
 * DROPS pages for large content sites — a single Iranopedia scan already
 * writes >430 snapshot rows in 2 days, so a tenant a little past ~250
 * pages would have its later pages vanish from every trigger (the same
 * silent-truncation class as the `getPages()` 1000-row incident).
 *
 * The NIGHTLY GENERATION path therefore reads through a separate,
 * fully-paginated method that must see EVERY page. These pins lock that
 * method (a) un-capped + paginated, (b) still egress-lean (no select('*'),
 * heavy payload fields omitted), and (c) actually used by the two
 * generation callers — so a refactor can't quietly route generation back
 * onto the 500-capped reader.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const SUPABASE_BACKEND = join(
  REPO_ROOT,
  "src/lib/persistence/repositories/supabase-backend.ts",
);
const TYPES = join(REPO_ROOT, "src/lib/persistence/repositories/types.ts");
const TRIGGER_LOADER = join(
  REPO_ROOT,
  "src/domains/recommendation-intelligence/load-trigger-candidates-for-tenant.ts",
);
const PROMOTION_WRITER = join(
  REPO_ROOT,
  "src/domains/recommendation-intelligence/promotion-writer.ts",
);

const SUPABASE_SRC = readFileSync(SUPABASE_BACKEND, "utf8");
const TYPES_SRC = readFileSync(TYPES, "utf8");
const TRIGGER_SRC = readFileSync(TRIGGER_LOADER, "utf8");
const WRITER_SRC = readFileSync(PROMOTION_WRITER, "utf8");

/** The tenant-scoped generation read block: from the method name to its
 *  return statement. Anchored on the method name so it never overlaps the
 *  capped `getPageSnapshots` block above it. */
const GEN_BLOCK = SUPABASE_SRC.match(
  /getAllPageSnapshotsForGeneration:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?return latest;\s*\}/,
);

describe("GENERATION-SNAPSHOTS-UNBOUNDED — interface", () => {
  it("declares the optional generation read on TenantRepository", () => {
    expect(TYPES_SRC).toMatch(
      /getAllPageSnapshotsForGeneration\?\(\):\s*Promise<PageSnapshot\[\]>/,
    );
  });
});

describe("GENERATION-SNAPSHOTS-UNBOUNDED — supabase backend impl", () => {
  it("implements the tenant-scoped generation read", () => {
    expect(GEN_BLOCK).toBeTruthy();
  });

  it("paginates via .range() and is NOT capped at limit(500)", () => {
    expect(GEN_BLOCK).toBeTruthy();
    if (GEN_BLOCK) {
      expect(GEN_BLOCK[0]).toMatch(/\.range\(from,\s*from \+ PAGE - 1\)/);
      expect(GEN_BLOCK[0]).not.toMatch(/\.limit\(500\)/);
    }
  });

  it("stays egress-lean: no select('*'), heavy payload fields omitted", () => {
    expect(GEN_BLOCK).toBeTruthy();
    if (GEN_BLOCK) {
      expect(GEN_BLOCK[0]).not.toMatch(/\.select\("\*"\)/);
      const select = GEN_BLOCK[0].match(/\.select\(\s*"([^"]+)",?\s*\)/);
      expect(select).toBeTruthy();
      if (select) {
        const cols = select[1];
        expect(cols).not.toMatch(/\bbody_paragraph_sample\b/);
        expect(cols).not.toMatch(/\bcard_texts\b/);
        expect(cols).not.toMatch(/\binternal_links\b/);
        expect(cols).not.toMatch(/\bschema_entity_names\b/);
      }
    }
  });

  it("dedups to latest-per-page (scoped by tenant_id)", () => {
    expect(GEN_BLOCK).toBeTruthy();
    if (GEN_BLOCK) {
      expect(GEN_BLOCK[0]).toMatch(/\.eq\("tenant_id",\s*tenantId\)/);
      expect(GEN_BLOCK[0]).toMatch(/seen\.has\(row\.page_id\)/);
    }
  });
});

describe("GENERATION-SNAPSHOTS-UNBOUNDED — callers prefer the generation read", () => {
  it("trigger loader prefers getAllPageSnapshotsForGeneration", () => {
    expect(TRIGGER_SRC).toMatch(
      /repo\.getAllPageSnapshotsForGeneration\s*\n?\s*\?\s*await repo\.getAllPageSnapshotsForGeneration\(\)/,
    );
  });

  it("promotion-writer prefers getAllPageSnapshotsForGeneration", () => {
    expect(WRITER_SRC).toMatch(/getAllPageSnapshotsForGeneration/);
  });
});
