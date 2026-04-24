import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Phase B (2026-04-24) — dedupe persistence contract.
 *
 * Before Phase B the "Different edits — keep both" button only updated
 * local React state. On refresh, findDedupePairs rebuilt the pair list
 * from `!archived && !dedupe_reviewed` and the same pair re-surfaced.
 * Phase B wires the button to `markPairNotDuplicate` so the decision
 * persists.
 *
 * These tests run against the server-action layer (not the React UI)
 * and verify:
 *
 *   - `archiveDuplicate` flips `archived=true` + writes to disk + Supabase
 *   - `markPairNotDuplicate` flips `dedupe_reviewed=true` + writes
 *   - `markPairNotDuplicate` surfaces error when entry is missing or
 *     already reviewed (no silent success)
 *   - A reviewed entry is excluded from `findDedupePairs` output so the
 *     pair genuinely disappears on next visit
 */

import type { ChangelogEntry } from "@/domains/changelog/types";

// ── Shared in-memory state across modules ─────────────────────────────

let mockChangelogEntries: ChangelogEntry[] = [];
let writeStoreCalls = 0;
let syncChangelogCalls = 0;
let backupCalls = 0;

function resetMocks() {
  mockChangelogEntries.length = 0;
  writeStoreCalls = 0;
  syncChangelogCalls = 0;
  backupCalls = 0;
}

function mkEntry(overrides: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: "cl-base",
    timestamp: "2026-04-10T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "https://ritzbuilders.com/services/whole-home-remodel",
    asset_name: "/services/whole-home-remodel",
    change_description: "Updated FAQ schema",
    topic_targeted: "Whole Home Remodel",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    tenant_id: "",
    ...overrides,
  };
}

// ── Module mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/seed-data.server", () => ({
  get changelogEntries() {
    return mockChangelogEntries;
  },
  briefs: [],
  opportunities: [],
}));

vi.mock("@/lib/persistence/json-store", () => ({
  writeStore: vi.fn(async () => {
    writeStoreCalls += 1;
  }),
  readStore: vi.fn(() => []),
}));

vi.mock("@/lib/persistence/dual-write", () => ({
  syncChangelogEntries: vi.fn(async () => {
    syncChangelogCalls += 1;
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// backupImportedChangesOnce lives inside domains/changelog/actions.ts and is
// called from softDeleteChangelogEntry. Needs node:fs + process.cwd. Mock it
// to a noop so tests don't hit disk.
vi.mock("node:fs", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(async () => undefined),
      copyFile: vi.fn(async () => {
        backupCalls += 1;
      }),
      access: vi.fn(async () => undefined),
    },
  };
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("Phase B — dedupe persistence", () => {
  beforeEach(() => {
    resetMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("archiveDuplicate flips archived=true + archived_reason + persists", async () => {
    const csv = mkEntry({ id: "cl-csv-1", source_system: "profound_csv" });
    const pdf = mkEntry({
      id: "cl-pdf-1",
      source_system: "changelog_pdf",
      timestamp: "2026-04-10T01:00:00Z",
    });
    mockChangelogEntries.push(csv, pdf);

    const { archiveDuplicate } = await import(
      "@/app/(shell)/changes/dedupe/actions"
    );
    const r = await archiveDuplicate("cl-csv-1", "cl-pdf-1");

    expect(r.success).toBe(true);
    expect(csv.archived).toBe(true);
    expect(csv.archived_reason).toBe("dedupe:csv_summary_of_cl-pdf-1");
    expect(csv.archived_at).toBeTruthy();
    expect(pdf.archived).toBeUndefined();
    expect(writeStoreCalls).toBeGreaterThan(0);
    expect(syncChangelogCalls).toBeGreaterThan(0);
  });

  it("markPairNotDuplicate flips dedupe_reviewed=true + writes to disk + Supabase", async () => {
    const csv = mkEntry({ id: "cl-csv-2", source_system: "profound_csv" });
    mockChangelogEntries.push(csv);

    const { markPairNotDuplicate } = await import(
      "@/app/(shell)/changes/dedupe/actions"
    );
    const r = await markPairNotDuplicate("cl-csv-2");

    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    expect(csv.dedupe_reviewed).toBe(true);
    expect(csv.dedupe_reviewed_at).toBeTruthy();
    expect(csv.archived).toBeUndefined();
    expect(writeStoreCalls).toBeGreaterThan(0);
    expect(syncChangelogCalls).toBeGreaterThan(0);
  });

  it("markPairNotDuplicate surfaces error when entry not found — no silent success", async () => {
    // No entries in the store at all.
    const { markPairNotDuplicate } = await import(
      "@/app/(shell)/changes/dedupe/actions"
    );
    const r = await markPairNotDuplicate("cl-does-not-exist");

    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).toMatch(/not found|already reviewed/i);
    // No write should have happened.
    expect(writeStoreCalls).toBe(0);
  });

  it("markPairNotDuplicate surfaces error when entry was already reviewed", async () => {
    const csv = mkEntry({
      id: "cl-csv-3",
      source_system: "profound_csv",
      dedupe_reviewed: true,
      dedupe_reviewed_at: "2026-04-20T00:00:00Z",
    });
    mockChangelogEntries.push(csv);

    const { markPairNotDuplicate } = await import(
      "@/app/(shell)/changes/dedupe/actions"
    );
    const r = await markPairNotDuplicate("cl-csv-3");

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already reviewed|not found/i);
    // No extra write.
    expect(writeStoreCalls).toBe(0);
  });

  it("findDuplicatePairs excludes entries flagged dedupe_reviewed=true", async () => {
    // Build a CSV summary + PDF granular that WOULD normally pair (same URL,
    // timestamps within 3 days, CSV tokens ⊆ PDF tokens), but mark the CSV
    // reviewed. Expect zero pairs returned — proves the dedupe_reviewed
    // filter at dedupe.ts:174 actually fires.
    const csv = mkEntry({
      id: "cl-csv-4",
      source_system: "changelog_csv",
      change_description: "Added FAQ schema",
      timestamp: "2026-04-10T00:00:00Z",
      dedupe_reviewed: true,
      dedupe_reviewed_at: "2026-04-21T00:00:00Z",
    });
    const pdf = mkEntry({
      id: "cl-pdf-4",
      source_system: "pdf_changelog_rebuild",
      change_description:
        "Added FAQ schema to existing FAQ content on /services/whole-home-remodel",
      timestamp: "2026-04-10T03:00:00Z",
    });

    const { findDuplicatePairs } = await import("@/domains/changelog/dedupe");
    const pairs = findDuplicatePairs([csv, pdf]);
    expect(pairs.length).toBe(0);

    // Sanity: with the dedupe_reviewed flag removed, the same inputs DO
    // produce at least one pair (proving the pairing itself would fire
    // and only the flag is suppressing it).
    const csvUnreviewed = { ...csv, dedupe_reviewed: false };
    delete (csvUnreviewed as Partial<ChangelogEntry>).dedupe_reviewed_at;
    const pairs2 = findDuplicatePairs([csvUnreviewed, pdf]);
    expect(pairs2.length).toBeGreaterThan(0);
  });
});
