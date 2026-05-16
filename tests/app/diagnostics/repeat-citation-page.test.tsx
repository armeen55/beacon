/**
 * Section 5.A.2 — operator-only /diagnostics/repeat-citation page
 * render contract.
 *
 * Pins:
 *   - Operator gate: page calls `notFound()` when
 *     `isOperatorModeServer()` returns false (no data reads attempted).
 *   - Operator true: summary card + per-edit table render.
 *   - 0 eligible edits → empty-state copy renders.
 *   - Still-learning band renders.
 *   - Stable band renders.
 *   - Per-platform display shows ChatGPT + Perplexity per-edit.
 *   - Top-20 limit when more eligible edits exist.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// ─────────────────────────────────────────────────────────────────────
// next/navigation — notFound throws so the test can detect the gate
// ─────────────────────────────────────────────────────────────────────

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

// ─────────────────────────────────────────────────────────────────────
// Operator-mode stub
// ─────────────────────────────────────────────────────────────────────

let _operatorModeEnabled = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operatorModeEnabled,
}));

// ─────────────────────────────────────────────────────────────────────
// Tenant context + business config
// ─────────────────────────────────────────────────────────────────────

const TENANT = "tenant-ritz-founder";

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => TENANT,
}));

let _readsBeforeGate = 0;
vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => {
    _readsBeforeGate++;
    return { name: "Ritz Builders" };
  },
}));

// ─────────────────────────────────────────────────────────────────────
// Repository — captures whether reads occur pre-gate
// ─────────────────────────────────────────────────────────────────────

type EditFixture = {
  id: string;
  tenant_id: string;
  rec_id: string;
  action_type: string;
  target_url: string;
  target_element_key: string | null;
  implementation_status:
    | "verified_live"
    | "verified_live_modified"
    | "partially_implemented"
    | "recommended"
    | "dismissed"
    | "wrong_page"
    | "needs_review"
    | "not_found_after_7d";
  live_at: string | null;
};

let _edits: EditFixture[] = [];

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (_tenantId: string) => ({
      getRecommendedEdits: async () => {
        _readsBeforeGate++;
        return _edits;
      },
    }),
  }),
}));

// ─────────────────────────────────────────────────────────────────────
// Compute + loader: stub the loader to return controlled results
// ─────────────────────────────────────────────────────────────────────

import type { RepeatCitationResult } from "@/domains/citation-lifecycle/compute-repeat-citation";

const loaderCallLog: Array<{
  tenantId: string;
  editId: string;
  windowDays: number;
}> = [];

type FixtureKey = string; // `${editId}:${windowDays}`
let _resultFixtures = new Map<FixtureKey, RepeatCitationResult>();

vi.mock("@/domains/citation-lifecycle/load-repeat-citation", () => ({
  loadRepeatCitationForEdit: async (opts: {
    tenantId: string;
    recommendedEdit: { id: string };
    windowDays: number;
  }): Promise<RepeatCitationResult> => {
    _readsBeforeGate++;
    loaderCallLog.push({
      tenantId: opts.tenantId,
      editId: opts.recommendedEdit.id,
      windowDays: opts.windowDays,
    });
    const k = `${opts.recommendedEdit.id}:${opts.windowDays}`;
    return (
      _resultFixtures.get(k) ?? {
        eligible: true,
        eligibility_reason: "eligible_verified_live",
        window_days: opts.windowDays,
        polling_days: 0,
        distinct_citation_days: 0,
        citation_rate: null,
        band: "still_learning",
        per_platform: {
          chatgpt: { polling_days: 0, distinct_citation_days: 0 },
          perplexity: { polling_days: 0, distinct_citation_days: 0 },
          google_ai_overviews: null,
        },
        first_citation_date_iso: null,
      }
    );
  },
}));

// ─────────────────────────────────────────────────────────────────────
// SUT
// ─────────────────────────────────────────────────────────────────────

import RepeatCitationDiagnosticPage from "@/app/(shell)/diagnostics/repeat-citation/page";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function eligibleEdit(over: Partial<EditFixture> = {}): EditFixture {
  return {
    id: over.id ?? "edit-1",
    tenant_id: over.tenant_id ?? TENANT,
    rec_id: over.rec_id ?? "rec-1",
    action_type: over.action_type ?? "edit_title",
    target_url:
      over.target_url ?? "https://ritzbuilders.com/services/whole-home-remodel",
    target_element_key: over.target_element_key ?? null,
    implementation_status: over.implementation_status ?? "verified_live",
    // Honor explicit `null` overrides (the optional `?` makes
    // `over.live_at` `string | null | undefined`; narrow to the
    // EditFixture shape after the override check).
    live_at:
      "live_at" in over
        ? (over.live_at ?? null)
        : "2026-05-01T12:00:00.000Z",
  };
}

function ineligibleEdit(over: Partial<EditFixture> = {}): EditFixture {
  return eligibleEdit({
    id: over.id ?? "edit-ineligible",
    implementation_status: "recommended",
    ...over,
  });
}

function stableResult(windowDays: number): RepeatCitationResult {
  return {
    eligible: true,
    eligibility_reason: "eligible_verified_live",
    window_days: windowDays,
    polling_days: 10,
    distinct_citation_days: 6,
    citation_rate: 0.6,
    band: "stable",
    per_platform: {
      chatgpt: { polling_days: 10, distinct_citation_days: 3 },
      perplexity: { polling_days: 10, distinct_citation_days: 3 },
      google_ai_overviews: null,
    },
    first_citation_date_iso: "2026-05-03",
  };
}

function stillLearningResult(windowDays: number): RepeatCitationResult {
  return {
    eligible: true,
    eligibility_reason: "eligible_verified_live",
    window_days: windowDays,
    polling_days: 4,
    distinct_citation_days: 0,
    citation_rate: null,
    band: "still_learning",
    per_platform: {
      chatgpt: { polling_days: 4, distinct_citation_days: 0 },
      perplexity: { polling_days: 4, distinct_citation_days: 0 },
      google_ai_overviews: null,
    },
    first_citation_date_iso: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _operatorModeEnabled = true;
  _readsBeforeGate = 0;
  _edits = [];
  _resultFixtures = new Map();
  loaderCallLog.length = 0;
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/repeat-citation — operator gate", () => {
  it("operator-mode true → renders the page", async () => {
    _operatorModeEnabled = true;
    _edits = [eligibleEdit()];
    const node = await RepeatCitationDiagnosticPage();
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Repeat-citation classifier");
  });

  it("operator-mode false → notFound() thrown, no data reads attempted", async () => {
    _operatorModeEnabled = false;
    _edits = [eligibleEdit()];
    let threw = false;
    try {
      await RepeatCitationDiagnosticPage();
    } catch (err) {
      threw = err instanceof NotFoundError;
    }
    expect(threw).toBe(true);
    // No business-config, repo, or loader read should have fired.
    expect(_readsBeforeGate).toBe(0);
    expect(loaderCallLog).toHaveLength(0);
  });
});

describe("/diagnostics/repeat-citation — content", () => {
  it("renders summary card with 3-window grid + brand name", async () => {
    _edits = [eligibleEdit()];
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain("Operator view — repeat-citation classifier · Ritz Builders");
    expect(html).toContain("Observed citation stability");
    expect(html).toContain("30-day window");
    expect(html).toContain("60-day window");
    expect(html).toContain("90-day window");
  });

  it("0 eligible edits → empty state copy renders", async () => {
    _edits = []; // no edits at all
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain(
      "No eligible edits yet — repeat citation stability needs verified-live edits with a target URL.",
    );
  });

  it("ineligible edits are excluded from the table", async () => {
    _edits = [
      ineligibleEdit({ id: "edit-recommended" }),
      ineligibleEdit({ id: "edit-no-live", live_at: null, implementation_status: "verified_live" }),
    ];
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain(
      "No eligible edits yet — repeat citation stability needs verified-live edits with a target URL.",
    );
    expect(loaderCallLog).toHaveLength(0);
  });

  it("renders stable band with correct counts + percentage", async () => {
    _edits = [eligibleEdit({ id: "edit-stable" })];
    for (const w of [30, 60, 90]) {
      _resultFixtures.set(`edit-stable:${w}`, stableResult(w));
    }
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain("Stable");
    expect(html).toContain("Cited 6 of 10 poll days");
    expect(html).toContain("(60%)");
  });

  it("renders still-learning band when polling_days < 7", async () => {
    _edits = [eligibleEdit({ id: "edit-learning" })];
    for (const w of [30, 60, 90]) {
      _resultFixtures.set(`edit-learning:${w}`, stillLearningResult(w));
    }
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain("Still learning");
  });

  it("renders per-platform ChatGPT + Perplexity for each row (30d)", async () => {
    _edits = [eligibleEdit({ id: "edit-stable" })];
    for (const w of [30, 60, 90]) {
      _resultFixtures.set(`edit-stable:${w}`, stableResult(w));
    }
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain("ChatGPT:");
    expect(html).toContain("Perplexity:");
    expect(html).toContain("3 / 10 poll days");
  });

  it("limits the table to TOP_N=20 most-recent eligible edits", async () => {
    // Seed 25 eligible edits with descending live_at values; the
    // 5 oldest should be excluded.
    const edits: EditFixture[] = [];
    for (let i = 0; i < 25; i++) {
      const day = String(i + 1).padStart(2, "0");
      edits.push(
        eligibleEdit({
          id: `edit-${i}`,
          live_at: `2026-05-${day}T00:00:00.000Z`,
        }),
      );
    }
    _edits = edits;
    await RepeatCitationDiagnosticPage();
    // Each eligible edit triggers 3 loader calls (30/60/90).
    // Top 20 → 60 calls total.
    expect(loaderCallLog).toHaveLength(60);
    const uniqueEditIds = new Set(loaderCallLog.map((c) => c.editId));
    expect(uniqueEditIds.size).toBe(20);
    // The 5 oldest (edit-0 .. edit-4 by date) must NOT appear.
    for (let i = 0; i < 5; i++) {
      expect(uniqueEditIds.has(`edit-${i}`)).toBe(false);
    }
  });
});

describe("/diagnostics/repeat-citation — polling_days=0 safe rendering (2026-05-16 bug-fix)", () => {
  it("polling_days=0 + historical first citation → renders 'Still learning' + safe denominator copy; NEVER 'Cited X of 0 poll days'", async () => {
    _edits = [eligibleEdit({ id: "edit-zero-polls" })];
    const stillLearningWithHistory = (windowDays: number): RepeatCitationResult => ({
      eligible: true,
      eligibility_reason: "eligible_verified_live",
      window_days: windowDays,
      polling_days: 0,
      distinct_citation_days: 0,
      citation_rate: null,
      band: "still_learning",
      per_platform: {
        chatgpt: { polling_days: 0, distinct_citation_days: 0 },
        perplexity: { polling_days: 0, distinct_citation_days: 0 },
        google_ai_overviews: null,
      },
      first_citation_date_iso: "2026-04-28",
    });
    for (const w of [30, 60, 90]) {
      _resultFixtures.set(`edit-zero-polls:${w}`, stillLearningWithHistory(w));
    }
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());

    // SAFE: the safe copy renders.
    expect(html).toContain("0 successful native poll days in this window");
    expect(html).toContain("Still learning");

    // FORBIDDEN: pre-fix output that the bug produced.
    expect(html).not.toContain("Cited 3 of 0 poll days");
    expect(html).not.toContain(" of 0 poll days (");
    // No "X / 0 poll days" pattern where X > 0 in per-platform.
    expect(html).not.toMatch(/[1-9]\d*\s*\/\s*0\s*poll days/);

    // First-cited column still populated from the historical date.
    expect(html).toContain("2026-04-28");
  });

  it("polling_days=0 per-platform row renders '0 / 0 poll days' (consistent, not the bug pattern)", async () => {
    _edits = [eligibleEdit({ id: "edit-zero-platform" })];
    for (const w of [30, 60, 90]) {
      _resultFixtures.set(`edit-zero-platform:${w}`, {
        eligible: true,
        eligibility_reason: "eligible_verified_live",
        window_days: w,
        polling_days: 0,
        distinct_citation_days: 0,
        citation_rate: null,
        band: "still_learning",
        per_platform: {
          chatgpt: { polling_days: 0, distinct_citation_days: 0 },
          perplexity: { polling_days: 0, distinct_citation_days: 0 },
          google_ai_overviews: null,
        },
        first_citation_date_iso: null,
      });
    }
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain("0 / 0 poll days");
    // Negative check: no bug pattern.
    expect(html).not.toMatch(/[1-9]\d*\s*\/\s*0\s*poll days/);
  });
});

describe("/diagnostics/repeat-citation — data-sources footer", () => {
  it("references getProfoundImportRuns + tenant-scoped repo in footer", async () => {
    _edits = [eligibleEdit()];
    const html = renderToStaticMarkup(await RepeatCitationDiagnosticPage());
    expect(html).toContain("getProfoundImportRuns");
    expect(html).toContain("Prompt-answer observations");
    expect(html).toContain("Benchmark citations");
  });
});
