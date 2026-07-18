import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 6 — wiring + dual-write helper invariants.
//
// Three layers:
//
//  1. `syncPageElementInventory` dual-write helper behavior:
//       - off when DUAL_WRITE != "true"
//       - off for empty rows
//       - upserts to "page_element_inventory" with onConflict
//         "source_snapshot_id,element_key" when on
//
//  2. Source-scan wiring invariants — scan-owned-pages.ts and
//     orchestrate-scan.ts call the right helpers in the right order, so
//     the inventory pipeline can't silently regress. (verify-action.ts's
//     wiring pin was removed 2026-07-02, UX5 sweep, when the unreachable
//     /pages route it lived in was deleted.)
//
//  3. No-route-render-extraction invariant — extractAllElements (the
//     dispatcher) MUST NOT be imported from any route render path. The
//     dispatcher belongs in scan + verify code only; pulling it into a
//     server component would re-introduce the cross-lambda staleness +
//     compute-on-render anti-pattern Sprints 1 + 4 fixed.
// ---------------------------------------------------------------------------

const SCAN_CLI_PATH = resolve(__dirname, "../scripts/scan-owned-pages.ts");
const SCAN_CLI_SOURCE = readFileSync(SCAN_CLI_PATH, "utf8");

const ORCHESTRATE_PATH = resolve(
  __dirname,
  "../src/domains/scanning/orchestrate-scan.ts",
);
const ORCHESTRATE_SOURCE = readFileSync(ORCHESTRATE_PATH, "utf8");

const PERSIST_PATH = resolve(
  __dirname,
  "../src/domains/pages/extractors/persist.ts",
);
const PERSIST_SOURCE = readFileSync(PERSIST_PATH, "utf8");

const DUAL_WRITE_PATH = resolve(
  __dirname,
  "../src/lib/persistence/dual-write.ts",
);
const DUAL_WRITE_SOURCE = readFileSync(DUAL_WRITE_PATH, "utf8");

// ── 1. Dual-write helper behavior ──────────────────────────────────────────

describe("Phase 6A.1.6 — syncPageElementInventory helper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DUAL_WRITE;
    vi.restoreAllMocks();
  });

  it("is a no-op when DUAL_WRITE != 'true'", async () => {
    delete process.env.DUAL_WRITE;
    const upsertMock = vi.fn(async () => undefined);
    vi.doMock("@/lib/persistence/supabase", () => ({
      getSupabaseAdmin: () => ({
        from: () => ({ upsert: upsertMock }),
      }),
    }));
    const { syncPageElementInventory } = await import(
      "@/lib/persistence/dual-write"
    );
    // Phase 7.7b Commit 5 (2026-04-25): syncPageElementInventory now requires tenantId.
    await syncPageElementInventory(
      [
        {
          id: "snap-1__title[0]:abc",
          tenant_id: "t",
          page_id: "pg",
          url: "https://example.com/",
          element_type: "title",
          element_key: "title[0]:abc",
          display_label: "Title",
          element_text: "x",
          element_metadata: {},
          extractor_version: 1,
          observed_at: "2026-04-24T00:00:00Z",
          source_snapshot_id: "snap-1",
        },
      ],
      "t",
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("is a no-op for an empty rows array even when DUAL_WRITE='true'", async () => {
    process.env.DUAL_WRITE = "true";
    const upsertMock = vi.fn(async () => ({ error: null }));
    vi.doMock("@/lib/persistence/supabase", () => ({
      getSupabaseAdmin: () => ({
        from: () => ({ upsert: upsertMock }),
      }),
    }));
    const { syncPageElementInventory } = await import(
      "@/lib/persistence/dual-write"
    );
    await syncPageElementInventory([], "t");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upserts to 'page_element_inventory' with onConflict 'tenant_id,source_snapshot_id,element_key' when on", async () => {
    process.env.DUAL_WRITE = "true";
    let lastTable = "";
    let lastOptions: { onConflict?: string } = {};
    const upsertMock = vi.fn(async (_chunk, opts) => {
      lastOptions = opts ?? {};
      return { error: null };
    });
    vi.doMock("@/lib/persistence/supabase", () => ({
      getSupabaseAdmin: () => ({
        from: (table: string) => {
          lastTable = table;
          return { upsert: upsertMock };
        },
      }),
    }));
    const { syncPageElementInventory } = await import(
      "@/lib/persistence/dual-write"
    );
    await syncPageElementInventory(
      [
        {
          id: "snap-1__h2[0]:abc",
          tenant_id: "t",
          page_id: "pg",
          url: "https://example.com/",
          element_type: "h2",
          element_key: "h2[0]:abc",
          display_label: "H2",
          element_text: "x",
          element_metadata: {},
          extractor_version: 1,
          observed_at: "2026-04-24T00:00:00Z",
          source_snapshot_id: "snap-1",
        },
      ],
      "t",
    );
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(lastTable).toBe("page_element_inventory");
    // 2026-04-27 onConflict-audit fix: spec extended to include
    // tenant_id (matches `ux_pei_tenant_snapshot_element_key` —
    // the Phase 7.7d multi-tenant index). The PRIOR assertion
    // pinned the buggy 2-column spec. See
    // tests/architecture/dual-write-onconflict.test.ts for the
    // full audit history.
    expect(lastOptions.onConflict).toBe(
      "tenant_id,source_snapshot_id,element_key",
    );
  });
});

// verify-action.ts (the /pages route's manual re-verify action) was deleted
// 2026-07-02 (UX5 legacy sweep) along with the rest of the unreachable /pages
// route — the "verify-action.ts wiring" describe block that lived here is
// gone with it. `persistPageElements` (src/domains/pages/extractors/persist.ts)
// has no remaining production caller today; kept as-is (small, side-effect-only,
// still directly unit-tested) rather than deleted in this pass.

// ── 2. Wiring invariants — scan-owned-pages.ts ─────────────────────────────

describe("Phase 6A.1.6 — scan-owned-pages.ts CLI wiring", () => {
  it("imports buildPageElementRows + PageElementInventoryRow type", () => {
    expect(SCAN_CLI_SOURCE).toMatch(
      /from ["']\.\.\/src\/domains\/pages\/extractors\/persist["']/,
    );
    expect(SCAN_CLI_SOURCE).toMatch(/buildPageElementRows/);
    expect(SCAN_CLI_SOURCE).toMatch(/PageElementInventoryRow/);
  });

  it("calls buildPageElementRows inside the page-fetch loop", () => {
    // Loop body contains both the snapshot push and the inventory call.
    expect(SCAN_CLI_SOURCE).toMatch(
      /newSnapshots\.push\(stamped\)[\s\S]*?buildPageElementRows\(\{/,
    );
  });

  it("wraps buildPageElementRows in try/catch (single-page failure does not abort the scan)", () => {
    expect(SCAN_CLI_SOURCE).toMatch(
      /try\s*\{[\s\S]*?buildPageElementRows\([\s\S]*?\}\s*catch/,
    );
  });

  it("writes the inventory rows to .data/page-element-inventory.json near the snapshot save", () => {
    expect(SCAN_CLI_SOURCE).toMatch(/saveElementInventory\(persistedElementRows\)/);
    expect(SCAN_CLI_SOURCE).toContain("mergeLatestCanonicalInventory");
    expect(SCAN_CLI_SOURCE).toMatch(/page-element-inventory\.json/);
  });

  it("threads tenantId from currentTenantId() resolver (no Ritz hardcode in the call site)", () => {
    // Sprint 7 Phase 7.5d/2 (2026-04-25) — fail-loud resolver replaces the
    // direct env-with-default. The resolver reads `BEACON_TENANT_ID` env
    // internally; the script no longer references it directly.
    expect(SCAN_CLI_SOURCE).toMatch(/await\s+currentTenantId\(\)/);
    expect(SCAN_CLI_SOURCE).toMatch(/tenantId:\s*tenantIdForInventory/);
    // Forbidden: silent ritz fallback at the script level.
    expect(SCAN_CLI_SOURCE).not.toMatch(/process\.env\.BEACON_TENANT_ID\s*\?\?\s*"tenant-ritz-founder"/);
  });

  it("threads city + service dictionaries from .data/business-config.json (not Ritz-hardcoded)", () => {
    expect(SCAN_CLI_SOURCE).toMatch(/loadInventoryDictionaries/);
    expect(SCAN_CLI_SOURCE).toMatch(/cityDictionary/);
    expect(SCAN_CLI_SOURCE).toMatch(/serviceDictionary/);
  });
});

// ── 2. Wiring invariants — orchestrate-scan.ts ─────────────────────────────

describe("Phase 6A.1.6 — orchestrate-scan.ts wiring", () => {
  it("imports syncPageElementInventory + PageElementInventoryRow type", () => {
    expect(ORCHESTRATE_SOURCE).toMatch(/syncPageElementInventory/);
    expect(ORCHESTRATE_SOURCE).toMatch(/PageElementInventoryRow/);
  });

  it("reads .data/page-element-inventory.json and calls syncPageElementInventory in the dual-write block", () => {
    expect(ORCHESTRATE_SOURCE).toMatch(
      /readDotDataJson<PageElementInventoryRow\[\]>\(\s*["']page-element-inventory["']/,
    );
    // Phase 7.7b Commit 5 (2026-04-25): syncPageElementInventory now requires tenantId.
    expect(ORCHESTRATE_SOURCE).toMatch(
      /syncPageElementInventory\(syncInventory,\s*tenantId\)/,
    );
  });

  it("wraps the inventory dual-write in try/catch so it cannot regress the scan", () => {
    expect(ORCHESTRATE_SOURCE).toMatch(
      /try\s*\{[\s\S]*?syncPageElementInventory\(syncInventory,\s*tenantId\)[\s\S]*?\}\s*catch/,
    );
  });
});

// ── 3. No-route-render-extraction invariant ────────────────────────────────

function walkSync(dir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile() && predicate(full)) out.push(full);
    }
  }
  return out;
}

describe("Phase 6A.1.6 — extractor never runs on render", () => {
  it("dispatcher is NOT imported from any route page.tsx or route.ts", () => {
    const appDir = resolve(__dirname, "../src/app");
    const matches = walkSync(
      appDir,
      (p) => p.endsWith("/page.tsx") || p.endsWith("/route.ts"),
    );
    const offenders: string[] = [];
    for (const file of matches) {
      const src = readFileSync(file, "utf8");
      if (
        /from\s+["'][^"']*pages\/extractors\/dispatcher["']/.test(src) ||
        /\bextractAllElements\b/.test(src) ||
        /\bbuildPageElementRows\b/.test(src) ||
        /\bpersistPageElements\b/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("persist.ts has 'server-only' import (cannot accidentally land in a client bundle)", () => {
    expect(PERSIST_SOURCE).toMatch(/import\s+["']server-only["']/);
  });
});

// ── Dual-write helper source signature ─────────────────────────────────────

describe("Phase 6A.1.6 — syncPageElementInventory source signature", () => {
  it("the helper definition uses 'page_element_inventory' as the table name", () => {
    expect(DUAL_WRITE_SOURCE).toMatch(
      /dualWriteUpsert\(\s*["']page_element_inventory["']/,
    );
  });

  it("the helper definition uses the compound onConflict 'source_snapshot_id,element_key'", () => {
    expect(DUAL_WRITE_SOURCE).toMatch(
      /["']source_snapshot_id,element_key["']/,
    );
  });
});
