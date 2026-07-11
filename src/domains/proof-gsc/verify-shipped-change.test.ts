/**
 * verify-shipped-change.test.ts (J-73/C-25, 2026-07-09).
 *
 * Two layers:
 *   1. Unit tests on the pure `classify()` seam - the ONE place all six
 *      verify states are produced - using hand-computed similarity fixtures
 *      (see scratchpad exploration) so every bucket boundary is exact, not
 *      guessed.
 *   2. Integration tests on `verifyShippedChange()` end to end (real
 *      `extractPageSnapshot` + `fetchPageHtml`, fetch mocked - no network)
 *      covering the crawl-failure / tenant-safety / persistence contract
 *      the pure classify tests can't reach.
 *
 * No LLM anywhere - every assertion is on deterministic output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  verifyShippedChange,
  classify,
  candidatesForActionType,
  claimTokensPreserved,
} from "./verify-shipped-change";
import type { ShippedChangeRecord, VerifyState, EditDiffRecord } from "./shipped-change-store";
import { normalizeTextBoth } from "@/domains/recommendations/match-engine/normalize-text";
import { ACTION_THRESHOLDS } from "@/domains/recommendations/match-engine/types";

const fold = (s: string): string => normalizeTextBoth(s).folded;

// ── classify() - pure, one seam produces all six states ────────────────────

describe("classify - the six verify states", () => {
  const titleThresholds = ACTION_THRESHOLDS.edit_title!; // { modified: 0.85, medium: 0.5 }

  it("1. exact match (similarity 1 after normalize) -> verified_live/exact", () => {
    const { state, best } = classify(
      fold("Best Persian Restaurants in Tehran"),
      [{ field: "title", text: "  Best Persian Restaurants in Tehran  " }],
      titleThresholds,
    );
    expect(state).toEqual({ outcome: "verified_live", kind: "exact" });
    expect(best?.sim).toBe(1);
  });

  it("2. semantically equivalent edit (>= modified, claims preserved) -> verified_live/modified", () => {
    // sim = 0.8947 (hand-computed) - above the 0.85 edit_title modified bar;
    // only "the" was added, every claim token (best/persian/restaurants/
    // tehran) survives.
    const { state } = classify(
      fold("Best Persian Restaurants in Tehran"),
      [{ field: "title", text: "The Best Persian Restaurants in Tehran" }],
      titleThresholds,
    );
    expect(state).toEqual({ outcome: "verified_live", kind: "modified" });
  });

  it("3. operator-modified but shipped (>= modified, claim/entity drift) -> verified_live_modified", () => {
    // sim = 0.9322 (hand-computed) - Tehran swapped for Shiraz; every other
    // word (including the year 2026) survives, so it clears "modified" easily,
    // but the entity itself changed.
    const { state } = classify(
      fold("The Best Persian Restaurants in Tehran for Families in 2026"),
      [{ field: "title", text: "The Best Persian Restaurants in Shiraz for Families in 2026" }],
      titleThresholds,
    );
    expect(state).toEqual({ outcome: "verified_live_modified", kind: null });
  });

  it("4. not found (below medium on a good crawl) -> not_found, never marks shipped", () => {
    // sim = 0.1471 (hand-computed) - unrelated page content.
    const { state, best } = classify(
      fold("Best Persian Restaurants in Tehran"),
      [{ field: "title", text: "Contact Us Customer Support Page" }],
      titleThresholds,
    );
    expect(state).toEqual({ outcome: "not_found", kind: null });
    expect(best).not.toBeNull(); // the crawl succeeded; it just doesn't match
  });

  it("4b. zero candidates on a good crawl (field genuinely absent) -> not_found, no editDiff basis", () => {
    const { state, best } = classify(fold("Best Persian Restaurants in Tehran"), [], titleThresholds);
    expect(state).toEqual({ outcome: "not_found", kind: null });
    expect(best).toBeNull();
  });

  it("5a. needs_review - medium-confidence single candidate (below modified, at/above medium)", () => {
    // sim = 0.7647 (hand-computed) - between medium (0.5) and modified (0.85),
    // only one candidate, so this is NOT the ambiguity path.
    const { state } = classify(
      fold("Best Persian Restaurants in Tehran"),
      [{ field: "title", text: "Best Persian Restaurants Guide" }],
      titleThresholds,
    );
    expect(state).toEqual({ outcome: "needs_review", kind: null });
  });

  it("5b. needs_review - ambiguous: top-2 candidates BOTH clear the modified threshold", () => {
    const h2Thresholds = ACTION_THRESHOLDS.add_h2_section!; // { modified: 0.7, medium: 0.5 }
    const proposal = fold("How to Find the Best Persian Restaurants in Tehran");
    // H2-1 sim=0.90, H2-2 sim=0.9074 (hand-computed) - both clear 0.7. A third,
    // unrelated candidate (sim=0.24) proves the low one is correctly ignored.
    const { state, best } = classify(
      proposal,
      [
        { field: "h2[0]", text: "How to Find the Best Persian Restaurants in Tehran Today" },
        { field: "h2[1]", text: "How to Find the Best Persian Restaurants Around Tehran" },
        { field: "h2[2]", text: "Contact our support team for help" },
      ],
      h2Thresholds,
    );
    expect(state).toEqual({ outcome: "needs_review", kind: null });
    // held on the (higher of the two) top candidate for the operator to see
    expect(best?.field).toBe("h2[1]");
  });

  it("6. an exact top match is NEVER ambiguous, even if a second candidate also clears modified", () => {
    const h2Thresholds = ACTION_THRESHOLDS.add_h2_section!;
    const proposal = fold("How to Find the Best Persian Restaurants in Tehran");
    const { state } = classify(
      proposal,
      [
        { field: "h2[0]", text: "How to Find the Best Persian Restaurants in Tehran" }, // exact
        { field: "h2[1]", text: "How to Find the Best Persian Restaurants Around Tehran" }, // sim 0.9074, also clears modified
      ],
      h2Thresholds,
    );
    expect(state).toEqual({ outcome: "verified_live", kind: "exact" });
  });

  it("boundary: similarity exactly AT the modified threshold clears it (inclusive >=)", () => {
    const sim = 0.7647058823529411; // hand-computed similarity(a, b) below
    const thresholds = { modified: sim, medium: 0.3 };
    const { state } = classify(
      fold("Best Persian Restaurants in Tehran"),
      [{ field: "title", text: "Best Persian Restaurants Guide" }],
      thresholds,
    );
    // exactly at the bar -> cleared (either verified_live/modified or
    // verified_live_modified - either way, NOT held as needs_review).
    expect(state.outcome).not.toBe("needs_review");
    expect(["verified_live", "verified_live_modified"]).toContain(state.outcome);
  });

  it("boundary: one hair below the modified threshold falls to needs_review", () => {
    const sim = 0.7647058823529411;
    const thresholds = { modified: sim + 0.0000001, medium: 0.3 };
    const { state } = classify(
      fold("Best Persian Restaurants in Tehran"),
      [{ field: "title", text: "Best Persian Restaurants Guide" }],
      thresholds,
    );
    expect(state).toEqual({ outcome: "needs_review", kind: null });
  });
});

describe("claimTokensPreserved", () => {
  it("is vacuously true when the proposal has no claim tokens to drift on", () => {
    expect(claimTokensPreserved(fold("in of to"), fold("something else entirely"))).toBe(true);
  });

  it("is false when a distinguishing entity/number drops out", () => {
    expect(
      claimTokensPreserved(fold("Best restaurants in Tehran 2026"), fold("Best restaurants in Shiraz")),
    ).toBe(false);
  });

  it("is true (order-independent) for a clause-reordered paraphrase", () => {
    expect(
      claimTokensPreserved(fold("Best restaurants in Tehran"), fold("Tehran's best restaurants, ranked")),
    ).toBe(true);
  });
});

// ── verifyShippedChange() end to end (real extractor, fetch mocked) ────────

function baseShipRecord(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "shipped-1",
    page: "https://site.com/persian-food",
    path: "/persian-food",
    actionType: "edit_title",
    before: "Old Title",
    after: "Best Persian Restaurants in Tehran",
    shippedAt: "2026-07-09T00:00:00.000Z",
    baseline: { clicks: 5, impressions: 50, ctr: 0.1, position: 8, windowDays: 28 },
    targetQueries: [],
    controlPages: [],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: false,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null, calibrationVersion: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...over,
  };
}

function htmlWithTitle(title: string): string {
  return `<html><head><title>${title}</title></head><body><p>Filler paragraph with enough words to pass the extractor's word floor easily.</p></body></html>`;
}

function htmlWithPassages(passages: string[]): string {
  const ps = passages.map((p) => `<p>${p}</p>`).join("\n");
  return `<html><head><title>Persian Food Guide</title></head><body>${ps}</body></html>`;
}

/** Router fetch: robots.txt always permissive (ok:false -> no disallows);
 *  the page URL resolves via `pageResolver`. */
function makeFetchImpl(pageResolver: (url: string) => Promise<Response> | Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) {
      return { ok: false } as Response;
    }
    return pageResolver(url);
  }) as unknown as typeof fetch;
}

function okHtml(html: string, status = 200): Response {
  return { ok: true, status, text: async () => html } as unknown as Response;
}

function baseDeps(over: Partial<Parameters<typeof verifyShippedChange>[1]> = {}) {
  return {
    getBusinessConfigImpl: (_tid: string) => ({ domain: "site.com" }),
    markVerifyResultImpl: vi.fn(async () => {}),
    now: () => "2026-07-09T12:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyShippedChange - end to end", () => {
  it("crawls the real page and classifies an exact title match", async () => {
    const fetchImpl = makeFetchImpl(() => okHtml(htmlWithTitle("Best Persian Restaurants in Tehran")));
    const deps = baseDeps({ fetchImpl });
    const record = baseShipRecord();
    const result = await verifyShippedChange({ tenantId: "tenant-a", record }, deps);

    expect(result.verifyState).toEqual({ outcome: "verified_live", kind: "exact" });
    expect(result.editDiff).toMatchObject({
      field: "title",
      proposedAfter: "Best Persian Restaurants in Tehran",
      liveText: "Best Persian Restaurants in Tehran",
      similarity: 1,
      verdict: "verified_live",
    });
    expect(deps.markVerifyResultImpl).toHaveBeenCalledWith(
      "tenant-a",
      "shipped-1",
      expect.objectContaining({ verifyState: { outcome: "verified_live", kind: "exact" } }),
    );
  });

  it("splitIntoPassages wiring: a passage-shaped edit (add_answer_block) is found among several body paragraphs", async () => {
    const proposal =
      "Persian restaurants in Tehran serve kabobs, stews, and fresh herbs every single night of the week.";
    const fetchImpl = makeFetchImpl(() =>
      okHtml(
        htmlWithPassages([
          "Welcome to our guide about the city and its many wonderful attractions for visitors.",
          proposal,
          "Contact us any time using the form at the bottom of this page for more information.",
        ]),
      ),
    );
    const deps = baseDeps({ fetchImpl });
    const record = baseShipRecord({ actionType: "add_answer_block", after: proposal });
    const result = await verifyShippedChange({ tenantId: "tenant-a", record }, deps);

    expect(result.verifyState).toEqual({ outcome: "verified_live", kind: "exact" });
    expect(result.editDiff?.field).toBe("passage[1]");
  });

  it("crawl failure (fetch throws / times out) -> crawl_failed, never verified_live", async () => {
    const fetchImpl = makeFetchImpl(() => {
      throw new Error("timeout");
    });
    const deps = baseDeps({ fetchImpl });
    const result = await verifyShippedChange({ tenantId: "tenant-a", record: baseShipRecord() }, deps);
    expect(result.verifyState).toEqual({ outcome: "crawl_failed", kind: null });
    expect(result.editDiff).toBeNull();
  });

  it("crawl failure (non-ok HTTP status) -> crawl_failed, never verified_live", async () => {
    const fetchImpl = makeFetchImpl(() => ({ ok: false, status: 500, text: async () => "" }) as unknown as Response);
    const deps = baseDeps({ fetchImpl });
    const result = await verifyShippedChange({ tenantId: "tenant-a", record: baseShipRecord() }, deps);
    expect(result.verifyState).toEqual({ outcome: "crawl_failed", kind: null });
  });

  it("never mutates the caller's record - `after` stays the original proposal", async () => {
    const fetchImpl = makeFetchImpl(() => okHtml(htmlWithTitle("Something completely different")));
    const deps = baseDeps({ fetchImpl });
    const record = baseShipRecord();
    const originalAfter = record.after;
    await verifyShippedChange({ tenantId: "tenant-a", record }, deps);
    expect(record.after).toBe(originalAfter);
  });

  it("editDiff persists proposedAfter + liveText as SEPARATE fields, without touching the original proposal", async () => {
    const fetchImpl = makeFetchImpl(() => okHtml(htmlWithTitle("Top Places to Eat in Tehran")));
    const deps = baseDeps({ fetchImpl });
    const record = baseShipRecord({ after: "Best Persian Restaurants in Tehran" });
    const result = await verifyShippedChange({ tenantId: "tenant-a", record }, deps);
    expect(result.editDiff?.proposedAfter).toBe("Best Persian Restaurants in Tehran");
    expect(result.editDiff?.liveText).toBe("Top Places to Eat in Tehran");
    expect(record.after).toBe("Best Persian Restaurants in Tehran"); // untouched
  });

  it("refuses to verify when there is no proposal text to compare (nothing captured at ship time)", async () => {
    const fetchImpl = makeFetchImpl(() => okHtml(htmlWithTitle("Anything")));
    const deps = baseDeps({ fetchImpl });
    const result = await verifyShippedChange(
      { tenantId: "tenant-a", record: baseShipRecord({ after: null }) },
      deps,
    );
    expect(result.verifyState).toEqual({ outcome: "crawl_failed", kind: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("verifyShippedChange - tenant safety (never crawl a URL that isn't this tenant's own domain)", () => {
  it("skips the crawl entirely (fetch never called) when the record's URL doesn't match the tenant's configured domain", async () => {
    const fetchImpl = makeFetchImpl(() => okHtml(htmlWithTitle("Best Persian Restaurants in Tehran")));
    // tenant-b's OWN domain is a totally different site than record.page.
    const deps = baseDeps({ fetchImpl, getBusinessConfigImpl: () => ({ domain: "other-tenant-site.com" }) });
    const result = await verifyShippedChange(
      { tenantId: "tenant-b", record: baseShipRecord({ page: "https://site.com/persian-food" }) },
      deps,
    );
    expect(result.verifyState).toEqual({ outcome: "crawl_failed", kind: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("two-tenant isolation: A's verify crawls + writes A's ledger only; B's page is never crawled under A", async () => {
    const fetchImpl = makeFetchImpl(() => okHtml(htmlWithTitle("Best Persian Restaurants in Tehran")));
    const configByTenant: Record<string, string> = {
      "tenant-a": "site-a.com",
      "tenant-b": "site-b.com",
    };
    const markVerifyResultImpl = vi.fn(async () => {});
    const deps = baseDeps({
      fetchImpl,
      markVerifyResultImpl,
      getBusinessConfigImpl: (tid: string) => ({ domain: configByTenant[tid] ?? "" }),
    });

    // Tenant A verifying ITS OWN page: crawls for real, writes to A's ledger.
    const recordA = baseShipRecord({ id: "a-1", page: "https://site-a.com/persian-food" });
    await verifyShippedChange({ tenantId: "tenant-a", record: recordA }, deps);
    expect(fetchImpl).toHaveBeenCalled();
    expect(markVerifyResultImpl).toHaveBeenCalledWith(
      "tenant-a",
      "a-1",
      expect.objectContaining({ verifyState: { outcome: "verified_live", kind: "exact" } }),
    );

    vi.mocked(fetchImpl).mockClear();
    markVerifyResultImpl.mockClear();

    // Tenant B handed a record whose URL belongs to A's site (e.g. a stale or
    // spoofed pageUrl) - never crawled, and B's write is an honest crawl_failed.
    const recordUnderB = baseShipRecord({ id: "b-1", page: "https://site-a.com/persian-food" });
    await verifyShippedChange({ tenantId: "tenant-b", record: recordUnderB }, deps);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(markVerifyResultImpl).toHaveBeenCalledWith(
      "tenant-b",
      "b-1",
      expect.objectContaining({ verifyState: { outcome: "crawl_failed", kind: null } }),
    );
  });
});

// ── candidatesForActionType - light coverage of the field mapping ──────────

describe("candidatesForActionType", () => {
  it("edit_meta -> the meta_description field only", () => {
    const candidates = candidatesForActionType(
      { meta_description: "A short description." } as never,
      "edit_meta",
    );
    expect(candidates).toEqual([{ field: "meta_description", text: "A short description." }]);
  });

  it("add_faq -> question + answer for every faq entry", () => {
    const candidates = candidatesForActionType(
      {
        faqs: [{ question: "Q1?", answer_excerpt: "A1.", source: "html_details" }],
      } as never,
      "add_faq",
    );
    expect(candidates).toEqual([
      { field: "faq[0].question", text: "Q1?" },
      { field: "faq[0].answer", text: "A1." },
    ]);
  });

  it("an unlisted action_type falls back to scoring every body passage", () => {
    const candidates = candidatesForActionType(
      { body_paragraph_sample: ["First real paragraph with enough words in it.", "Second one too, plenty of words."] } as never,
      "add_internal_link",
    );
    expect(candidates.map((c) => c.field)).toEqual(["passage[0]", "passage[1]"]);
  });
});

// ── P1-1 real-move check + P2 redirect host check (W5, 2026-07-09) ───────────
describe("classify - C-25 real-move check (P1-1)", () => {
  const titleThresholds = ACTION_THRESHOLDS.edit_title!;

  it("a small-delta proposal against the UNCHANGED old live text is HELD (needs_review), never verified", () => {
    const before = "Best Persian Restaurants in Tehran";
    const after = "Best Persian Restaurants in Tehran Today"; // a light edit of `before`
    // The page still shows the OLD text - the operator did not make the change.
    const { state } = classify(fold(after), [{ field: "title", text: before }], titleThresholds, fold(before));
    expect(state).toEqual({ outcome: "needs_review", kind: null });
  });

  it("the SAME small-delta proposal DOES verify once the live text actually matches it", () => {
    const before = "Best Persian Restaurants in Tehran";
    const after = "Best Persian Restaurants in Tehran Today";
    const { state } = classify(fold(after), [{ field: "title", text: after }], titleThresholds, fold(before));
    expect(state).toEqual({ outcome: "verified_live", kind: "exact" });
  });

  it("with no `before` supplied the check is a vacuous pass (behavior unchanged)", () => {
    const after = "Best Persian Restaurants in Tehran Today";
    const { state } = classify(
      fold(after),
      [{ field: "title", text: "The Best Persian Restaurants in Tehran Today" }],
      titleThresholds,
    );
    expect(state.outcome).not.toBe("needs_review"); // clears modified, nothing to distinguish against
  });
});

describe("verifyShippedChange - P1-1 real-move + P2 redirect host", () => {
  it("P1-1 end to end: crawl finds the OLD title still live for a small-delta edit -> needs_review, never verified", async () => {
    const before = "Best Persian Restaurants in Tehran";
    const after = "Best Persian Restaurants in Tehran Today";
    const fetchImpl = makeFetchImpl(() => okHtml(htmlWithTitle(before)));
    const deps = baseDeps({ fetchImpl });
    const record = baseShipRecord({ before, after });
    const result = await verifyShippedChange({ tenantId: "tenant-a", record }, deps);
    expect(result.verifyState).toEqual({ outcome: "needs_review", kind: null });
  });

  it("P2: a redirect that lands on a FOREIGN host -> crawl_failed (never verified against another site)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return { ok: false } as Response;
      return {
        ok: true,
        status: 200,
        url: "https://evil-other-site.com/landing",
        text: async () => htmlWithTitle("Best Persian Restaurants in Tehran"),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const deps = baseDeps({ fetchImpl });
    const result = await verifyShippedChange({ tenantId: "tenant-a", record: baseShipRecord() }, deps);
    expect(result.verifyState).toEqual({ outcome: "crawl_failed", kind: null });
  });

  it("P2: a SAME-host redirect (finalUrl on the tenant's own domain) still verifies", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return { ok: false } as Response;
      return {
        ok: true,
        status: 200,
        url: "https://site.com/persian-food/",
        text: async () => htmlWithTitle("Best Persian Restaurants in Tehran"),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const deps = baseDeps({ fetchImpl });
    const result = await verifyShippedChange({ tenantId: "tenant-a", record: baseShipRecord() }, deps);
    expect(result.verifyState).toEqual({ outcome: "verified_live", kind: "exact" });
  });
});
