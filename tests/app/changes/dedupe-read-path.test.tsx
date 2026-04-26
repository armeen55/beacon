import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Phase B read-fix (2026-04-24) — /changes/dedupe read path contract.
 *
 * The dedupe page used to import `changelogEntries` from
 * `@/lib/seed-data.server`, a module-level array hydrated once per
 * Vercel lambda cold start. When one lambda handled a "keep both"
 * click (markDedupeReviewedBulk → Supabase ✓), other warm lambdas
 * still served the pre-mutation array and re-surfaced the same pairs.
 *
 * Fix: the page now reads via `getRepository().getChangelogEntries()`
 * on every request. This test locks that contract in place.
 *
 * Contract:
 *   - /changes/dedupe must read changelog entries via `getRepository`,
 *     not from `@/lib/seed-data.server` module-level array.
 *   - When the repository returns entries flagged `dedupe_reviewed=true`,
 *     the page renders zero pairs regardless of what the module array
 *     holds.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";

// The module-level array from seed-data.server. We populate it with
// fake "stale" pairs that WOULD match findDuplicatePairs. If the page
// still reads from here, pairs will render. If the page reads fresh
// from the repository mock (which returns dedupe_reviewed=true rows),
// zero pairs render.
const STALE_MODULE_ENTRIES: ChangelogEntry[] = [];
const FRESH_REPO_ENTRIES: ChangelogEntry[] = [];

function mkEntry(o: Partial<ChangelogEntry> & { id: string }): ChangelogEntry {
  return {
    timestamp: "2026-04-10T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "https://ritzbuilders.com/services/whole-home-remodel",
    asset_name: "/services/whole-home-remodel",
    change_description: "Added FAQ schema",
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
    ...o,
  };
}

vi.mock("@/lib/seed-data.server", () => ({
  // If the page still reads from this module, it sees a stale pair that
  // would produce 1 dedupe pair. If the page has been migrated to the
  // repository, this array is never consulted.
  get changelogEntries() {
    return STALE_MODULE_ENTRIES;
  },
  briefs: [],
  opportunities: [],
  hasActiveExperiment: () => true,
}));

vi.mock("@/lib/persistence/repositories", () => {
  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — /changes/dedupe now reads
  // via `getRepository().forTenant(tenantId).getChangelogEntries()`.
  // Self-referential mock returns the same repo from `forTenant` so
  // overrides apply to both call shapes.
  const repo = {
    getChangelogEntries: async () => FRESH_REPO_ENTRIES,
    forTenant: (_tenantId: string) => repo,
  };
  return { getRepository: () => repo };
});

// Stub currentTenantId so /changes/dedupe doesn't need a real env or request.
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-ritz-founder",
}));

// Silence the logger / cache.
vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// The dedupe-client is a "use client" component — replace with a stub
// that just renders the number of pairs it received, so we can assert.
vi.mock("@/app/(shell)/changes/dedupe/dedupe-client", () => ({
  DedupeReview: ({ pairs }: { pairs: { keeper: { id: string } }[] }) => (
    <div data-testid="dedupe-pair-count">{String(pairs.length)}</div>
  ),
}));

// PageHeader is a client component too — stub.
vi.mock("@/components/data/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

describe("Phase B read-fix — /changes/dedupe reads fresh per request", () => {
  beforeEach(() => {
    STALE_MODULE_ENTRIES.length = 0;
    FRESH_REPO_ENTRIES.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders zero pairs when the REPOSITORY says dedupe_reviewed=true, regardless of the stale module array", async () => {
    // Build a CSV + PDF that WOULD pair via findDuplicatePairs.
    const csv = mkEntry({
      id: "cl-csv-1",
      source_system: "changelog_csv",
      change_description: "Added FAQ schema",
      timestamp: "2026-04-10T00:00:00Z",
    });
    const pdf = mkEntry({
      id: "cl-pdf-1",
      source_system: "pdf_changelog_rebuild",
      change_description:
        "Added FAQ schema to existing FAQ content on /services/whole-home-remodel",
      timestamp: "2026-04-10T03:00:00Z",
    });

    // Seed stale module with an UNREVIEWED pair — if the page still reads
    // here it'd show 1 pair.
    STALE_MODULE_ENTRIES.push({ ...csv }, { ...pdf });

    // Seed the repo (truth) with the SAME entries but CSV marked reviewed.
    FRESH_REPO_ENTRIES.push(
      { ...csv, dedupe_reviewed: true, dedupe_reviewed_at: "2026-04-24T17:22:47Z" },
      { ...pdf },
    );

    const { default: DedupePage } = await import(
      "@/app/(shell)/changes/dedupe/page"
    );
    const element = await DedupePage();
    const html = renderToStaticMarkup(element);
    // Zero pairs because repo says reviewed. If the page still read the
    // stale array, this would be 1.
    expect(html).toContain('data-testid="dedupe-pair-count">0<');
  });

  it("renders pairs from repository entries (not module-level array)", async () => {
    const csv = mkEntry({
      id: "cl-csv-2",
      source_system: "changelog_csv",
      change_description: "Added FAQ schema",
      timestamp: "2026-04-10T00:00:00Z",
    });
    const pdf = mkEntry({
      id: "cl-pdf-2",
      source_system: "pdf_changelog_rebuild",
      change_description:
        "Added FAQ schema to existing FAQ content on /services/whole-home-remodel",
      timestamp: "2026-04-10T03:00:00Z",
    });

    // Module array empty.
    // Repo (truth) has an unreviewed pair — page should show it.
    FRESH_REPO_ENTRIES.push(csv, pdf);

    const { default: DedupePage } = await import(
      "@/app/(shell)/changes/dedupe/page"
    );
    const element = await DedupePage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('data-testid="dedupe-pair-count">1<');
  });
});
