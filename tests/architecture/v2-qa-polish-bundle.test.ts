/**
 * v2 QA polish bundle — contract guardrails (2026-05-11).
 *
 * Source-level pins for fixes that don't have a natural render-
 * test home. Each invariant guards against a concrete regression
 * the full v2 QA audit surfaced.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("v2 QA polish — sidebar Changes badge filter (P1-2)", () => {
  const layout = read("src/app/(shell)/layout.tsx");

  it("narrows changesBadge to hurting-only verdicts (action-meaningful)", () => {
    // Two facts together pin the contract: (1) the badge filters
    // results from `getWatchingUrlOutcomes()`; (2) the filter
    // narrows to `verdict === "hurting"`. Perf bundle 6 (2026-05-12)
    // refactored the layout to await `getWatchingUrlOutcomes()` once
    // into a named variable (`watchingUrlOutcomes`), so the badge
    // is now `changesBadge = watchingUrlOutcomes.filter(...).length`
    // — same semantics, named-variable shape. Pin both shapes so
    // future refactors don't have to update this test for cosmetic
    // changes; only a regression that removes the filter or changes
    // the verdict label would fail.
    expect(layout).toMatch(/\bgetWatchingUrlOutcomes\s*\(/);
    expect(layout).toMatch(
      /changesBadge\s*=\s*(?:\(await\s+getWatchingUrlOutcomes\(\)\)|watchingUrlOutcomes)[\s\S]*?\.filter\(/,
    );
    expect(layout).toMatch(/o\.verdict\s*===\s*["']hurting["']/);
  });

  it("does NOT count the full watching set (too_early / nothing_yet / weak_signal) in the badge", () => {
    // Regression guard: prior to the polish bundle the badge was
    // `(await getWatchingUrlOutcomes()).length` with no narrower
    // filter — that counted in-flight verdicts as alarms.
    expect(layout).not.toMatch(
      /changesBadge\s*=\s*\(await\s+getWatchingUrlOutcomes\(\)\)\.length/,
    );
  });
});

describe("v2 QA polish — Today Working pending CTA (P2-2)", () => {
  const working = read("src/components/today/v2/today-v2-working.tsx");

  it("pending-implementation CTA points at the live v2 /changes (no dead ?legacy=1 escape)", () => {
    // 2026-06-16: the legacy /changes table was deleted in the dual-surface
    // collapse, so the old `?legacy=1` escape no-ops. The CTA now points at
    // the live v2 /changes, consistent with the sibling pending CTAs in
    // implementation-queue + today-do-next-card.
    expect(working).toContain('href="/changes?tab=pending_implementation"');
  });

  it("does NOT keep the dead ?legacy=1 escape link", () => {
    expect(working).not.toContain('href="/changes?legacy=1');
  });
});

describe("v2 QA polish — Today Recent Wins overflow defense (P1-1)", () => {
  const recentWins = read("src/components/today/v2/today-v2-recent-wins.tsx");

  it("article wrapper applies min-w-0 so the grid track can shrink", () => {
    // Pin two facts independently: the article carries the
    // `recent-wins` data-attr AND a `min-w-0` className. We assert
    // both via separate matches so the regex doesn't traverse the
    // JSX attribute order.
    expect(recentWins).toMatch(
      /<article[\s\S]*?className="min-w-0[\s\S]*?data-today-v2-card="recent-wins"/,
    );
  });

  it("list items + Link wrappers also carry min-w-0", () => {
    // The QA audit confirmed sibling today-v2-working.tsx already
    // had the right shape; we mirror it on the Recent Wins side.
    expect(recentWins).toMatch(/<li[\s\S]*?className="min-w-0"/);
    expect(recentWins).toMatch(
      /className="[^"]*\bblock\b[^"]*\bmin-w-0\b[^"]*"/,
    );
  });
});

describe("v2 QA polish — Changes detail Act 5 'Open recommendation' CTA (P2-3)", () => {
  const nextAction = read("src/domains/changes/proof-timeline/next-action.ts");

  it("routes the CTA to the /recommendations queue page, never a per-rec deep link", () => {
    // Pre-polish, this href was
    // `/recommendations/${encodeURIComponent(sourceRecId)}` — a
    // structurally wrong deep link that calmly landed on
    // RecommendationDetailNotFound for any rec that had rotated
    // out of the live queue.
    expect(nextAction).toMatch(
      /kind:\s*["']open_recommendation["'][\s\S]*?href:\s*["']\/recommendations\?v2=1["']/,
    );
  });

  it("does NOT deep-link by source_rec_id from the CTA resolver", () => {
    expect(nextAction).not.toMatch(
      /\/recommendations\/\$\{encodeURIComponent\(sourceRecId\)\}/,
    );
  });

  it("renames the CTA label so the promise matches the destination", () => {
    expect(nextAction).toMatch(
      /label:\s*["']See related recommendations["']/,
    );
    // The pre-polish "Open recommendation" label is gone from this
    // resolver.
    expect(nextAction).not.toMatch(/label:\s*["']Open recommendation["']/);
  });
});

describe("v2 QA polish — Recommendations detail Act 4 fallback (P2-5)", () => {
  const detailClient = read(
    "src/app/(shell)/recommendations/[id]/recommendation-detail-client.tsx",
  );

  it("renders 'Results' as the link text (not the literal path)", () => {
    // Pre-polish: `<Link href="...">/changes</Link>` — read as URL chrome.
    // Post-polish: link label is the noun. IA consolidation (2026-06-23): the
    // CTA now points at Results (/results), where the changes timeline lives.
    expect(detailClient).toMatch(
      /<Link\s+href="\/results"\s+className="text-accent-primary hover:underline"\s*>\s*Results\s*<\/Link>/,
    );
  });

  it("suppresses the in-flight measurement fallback for dismissed/deferred rows", () => {
    // Status gate added in the polish bundle.
    expect(detailClient).toMatch(
      /row\.status\s*===\s*["']dismissed["']\s*\|\|\s*row\.status\s*===\s*["']deferred["']/,
    );
    // Suppressed branch carries the new data-attr for tests.
    expect(detailClient).toContain(
      'data-recommendation-detail-measurement-suppressed="true"',
    );
  });

  it("does NOT render the literal path inside the link body (pre-polish bug)", () => {
    // The link body must be the noun "Results", never the raw URL.
    expect(detailClient).not.toMatch(
      /<Link\s+href="\/results"[^>]*>\s*\/results\s*<\/Link>/,
    );
  });
});
